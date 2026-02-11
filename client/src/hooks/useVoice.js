import { useState, useEffect, useRef, useCallback } from 'react';
import { useSocket } from './useSocket.jsx';

// ── Audio chimes ────────────────────────────────────────────────

function playChime(ctxRef, direction) {
  let ctx = ctxRef.current;
  if (!ctx || ctx.state === 'closed') {
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      ctxRef.current = ctx;
    } catch {
      return;
    }
  }
  const resumeP = ctx.state === 'suspended' ? ctx.resume() : Promise.resolve();
  resumeP.then(() => {
    const now = ctx.currentTime + 0.05;
    const vol = 0.18;
    const dur = 0.1;
    const gap = 0.04;
    const freqs = direction === 'up' ? [523.25, 659.25] : [659.25, 523.25];
    freqs.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const start = now + i * (dur + gap);
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(vol, start + 0.015);
      gain.gain.setValueAtTime(vol, start + dur - 0.02);
      gain.gain.linearRampToValueAtTime(0, start + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + dur + 0.02);
    });
  });
}

// ── Constants ───────────────────────────────────────────────────

const GATE_HOLD_MS = 300;

function computeThreshold(sensitivity) {
  return Math.max(2, Math.round(60 * Math.pow(0.97, sensitivity)));
}

function resampleLinear(input, fromRate, toRate) {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const outLen = Math.round(input.length / ratio);
  const output = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcIdx = i * ratio;
    const idx0 = Math.floor(srcIdx);
    const idx1 = Math.min(idx0 + 1, input.length - 1);
    const frac = srcIdx - idx0;
    output[i] = input[idx0] + (input[idx1] - input[idx0]) * frac;
  }
  return output;
}

// ── Hook ────────────────────────────────────────────────────────

export default function useVoice(channelId) {
  const { socket } = useSocket();
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [speakingPeers, setSpeakingPeers] = useState(new Set());
  const [testing, setTesting] = useState(false);
  const [peerStates, setPeerStates] = useState(new Map());
  const [sensitivity, setSensitivityState] = useState(() => {
    const saved = localStorage.getItem('disclone_voice_sensitivity');
    return saved !== null ? Number(saved) : 50;
  });

  const localStreamRef = useRef(null);
  const audioContextRef = useRef(null);
  const vadIntervalRef = useRef(null);
  const wasSpeakingRef = useRef(false);
  const loopbackRef = useRef(null);
  const channelIdRef = useRef(channelId);
  const playbackCtxRef = useRef(null);
  const isMutedRef = useRef(false);
  const sensitivityRef = useRef(sensitivity);
  const lastSpeechTimeRef = useRef(0);
  const playbackNodeRef = useRef(null);
  const encoderRef = useRef(null);
  const decodersRef = useRef(new Map());
  const peerCapsRef = useRef(new Map());

  channelIdRef.current = channelId;
  isMutedRef.current = isMuted;
  sensitivityRef.current = sensitivity;

  const setSensitivity = useCallback((val) => {
    const v = Math.max(0, Math.min(100, Math.round(val)));
    setSensitivityState(v);
    localStorage.setItem('disclone_voice_sensitivity', String(v));
  }, []);

  useEffect(() => {
    if (!channelId || !socket) return;
    let cancelled = false;

    // ── Playback AudioContext ──
    try {
      if (!playbackCtxRef.current || playbackCtxRef.current.state === 'closed') {
        playbackCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (playbackCtxRef.current.state === 'suspended') {
        playbackCtxRef.current.resume();
      }
    } catch (e) {
      console.error('[Voice] Playback AudioContext error:', e);
    }

    playChime(playbackCtxRef, 'up');

    // ── Receive & play remote audio ──

    function handleAudioChunk({ from, data, codec, seq, sampleRate }) {
      const playNode = playbackNodeRef.current;
      if (!playNode) return;

      if (codec === 'opus' && typeof AudioDecoder !== 'undefined') {
        let decoder = decodersRef.current.get(from);
        if (!decoder) {
          const playRate = playbackCtxRef.current?.sampleRate || 48000;
          decoder = new AudioDecoder({
            output: (audioData) => {
              try {
                let pcm = new Float32Array(audioData.numberOfFrames);
                audioData.copyTo(pcm, { planeIndex: 0 });
                audioData.close();
                if (playRate !== 48000) {
                  pcm = resampleLinear(pcm, 48000, playRate);
                }
                playNode.port.postMessage({ peerId: from, pcm }, [pcm.buffer]);
              } catch (e) {
                console.error('[Voice] Decode output error:', e);
              }
            },
            error: (e) => {
              console.error('[Voice] Decoder error:', e);
              decodersRef.current.delete(from);
            },
          });
          decoder.configure({ codec: 'opus', sampleRate: 48000, numberOfChannels: 1 });
          decodersRef.current.set(from, decoder);
        }
        try {
          const chunk = new EncodedAudioChunk({
            type: 'key',
            timestamp: (seq || 0) * 20000,
            data,
          });
          decoder.decode(chunk);
        } catch (e) {
          console.error('[Voice] Decode error:', e);
        }
      } else {
        // If Opus-encoded but we can't decode, skip (don't misinterpret as PCM)
        if (codec === 'opus') return;
        // PCM fallback
        const int16 = new Int16Array(data);
        let pcm = new Float32Array(int16.length);
        for (let i = 0; i < int16.length; i++) {
          pcm[i] = int16[i] / 32768;
        }
        const playRate = playbackCtxRef.current?.sampleRate || 48000;
        const srcRate = sampleRate || 48000;
        if (srcRate !== playRate) {
          pcm = resampleLinear(pcm, srcRate, playRate);
        }
        playNode.port.postMessage({ peerId: from, pcm }, [pcm.buffer]);
      }
    }

    // ── Socket event handlers ──

    function handleUserJoined({ socketId, capabilities }) {
      console.log(`[Voice] → user-joined: ${socketId}`, capabilities);
      if (capabilities) peerCapsRef.current.set(socketId, capabilities);
      playChime(playbackCtxRef, 'up');
    }

    function handleUserLeft({ socketId }) {
      console.log(`[Voice] → user-left: ${socketId}`);
      peerCapsRef.current.delete(socketId);
      playChime(playbackCtxRef, 'down');
      const decoder = decodersRef.current.get(socketId);
      if (decoder) {
        try { decoder.close(); } catch {}
        decodersRef.current.delete(socketId);
      }
      playbackNodeRef.current?.port.postMessage({ removePeer: socketId });
      setSpeakingPeers((prev) => {
        const s = new Set(prev);
        s.delete(socketId);
        return s;
      });
    }

    function handleSpeaking({ socketId, speaking }) {
      setSpeakingPeers((prev) => {
        const s = new Set(prev);
        if (speaking) s.add(socketId);
        else s.delete(socketId);
        return s;
      });
    }

    socket.on('audio:chunk', handleAudioChunk);
    socket.on('voice:user-joined', handleUserJoined);
    socket.on('voice:user-left', handleUserLeft);
    socket.on('voice:speaking', handleSpeaking);

    // ── Init ──

    async function init() {
      try {
        // ── Setup playback AudioWorklet ──
        const playCtx = playbackCtxRef.current;
        await playCtx.audioWorklet.addModule('/playback-processor.js');
        const playbackNode = new AudioWorkletNode(playCtx, 'playback-processor');
        playbackNode.connect(playCtx.destination);
        playbackNodeRef.current = playbackNode;

        if (cancelled) return;

        // ── Acquire mic ──
        if (!navigator.mediaDevices?.getUserMedia) {
          console.error('[Voice] getUserMedia not available');
          socket.emit('voice:join', { channelId });
          return;
        }

        console.log('[Voice] Requesting microphone...');
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        localStreamRef.current = stream;

        // ── Capture AudioContext (device default rate) ──
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const nativeRate = audioCtx.sampleRate;
        console.log('[Voice] AudioContext at', nativeRate, 'Hz');
        audioContextRef.current = audioCtx;

        // ── Load capture AudioWorklet ──
        await audioCtx.audioWorklet.addModule('/capture-processor.js');
        if (cancelled) return;

        // ── Voice processing chain ──
        const micSource = audioCtx.createMediaStreamSource(stream);

        const highPass = audioCtx.createBiquadFilter();
        highPass.type = 'highpass';
        highPass.frequency.value = 80;
        highPass.Q.value = 0.707;

        const lowPass = audioCtx.createBiquadFilter();
        lowPass.type = 'lowpass';
        lowPass.frequency.value = 12000;
        lowPass.Q.value = 0.707;

        const compressor = audioCtx.createDynamicsCompressor();
        compressor.threshold.value = -24;
        compressor.knee.value = 12;
        compressor.ratio.value = 4;
        compressor.attack.value = 0.003;
        compressor.release.value = 0.25;

        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.5;

        const captureNode = new AudioWorkletNode(audioCtx, 'capture-processor');

        // Chain: mic → HP → LP → compressor → captureNode (pass-through) → analyser → silent output
        micSource.connect(highPass);
        highPass.connect(lowPass);
        lowPass.connect(compressor);
        compressor.connect(captureNode);
        captureNode.connect(analyser);
        const silentGain = audioCtx.createGain();
        silentGain.gain.value = 0.00001;
        analyser.connect(silentGain);
        silentGain.connect(audioCtx.destination);

        // ── VAD (100ms interval for UI + gate timing) ──
        const vadData = new Uint8Array(analyser.frequencyBinCount);
        vadIntervalRef.current = setInterval(() => {
          analyser.getByteFrequencyData(vadData);
          let sum = 0;
          for (let i = 0; i < vadData.length; i++) sum += vadData[i];
          const avg = sum / vadData.length;
          const threshold = computeThreshold(sensitivityRef.current);
          const speaking = avg > threshold;
          setMicLevel(Math.min(100, Math.round((avg / 60) * 100)));

          if (speaking) {
            lastSpeechTimeRef.current = performance.now();
          }
          if (speaking !== wasSpeakingRef.current) {
            wasSpeakingRef.current = speaking;
            setIsSpeaking(speaking);
            socket.emit('voice:speaking', {
              channelId: channelIdRef.current,
              speaking,
            });
          }
        }, 100);

        // ── Opus encoder (WebCodecs) ──
        let useOpus = false;
        let encoder = null;
        let seqCounter = 0;

        if (typeof AudioEncoder !== 'undefined') {
          try {
            const config = {
              codec: 'opus',
              sampleRate: 48000,
              numberOfChannels: 1,
              bitrate: 32000,
            };
            const support = await AudioEncoder.isConfigSupported(config);
            if (support.supported) {
              useOpus = true;
              encoder = new AudioEncoder({
                output: (chunk) => {
                  if (cancelled) return;
                  const buf = new ArrayBuffer(chunk.byteLength);
                  chunk.copyTo(buf);
                  socket.volatile.emit('audio:chunk', {
                    channelId: channelIdRef.current,
                    data: buf,
                    codec: 'opus',
                    seq: seqCounter++,
                  });
                },
                error: (e) => {
                  console.error('[Voice] Encoder error:', e);
                  useOpus = false;
                },
              });
              encoder.configure(config);
              encoderRef.current = encoder;
              console.log('[Voice] Opus encoder ready');
            }
          } catch (e) {
            console.warn('[Voice] Opus not available, using PCM:', e.message);
          }
        }

        // ── Handle frames from capture worklet ──
        let frameTimestamp = 0;

        captureNode.port.onmessage = (e) => {
          if (isMutedRef.current || cancelled) return;
          const { pcm } = e.data;

          // VAD gate
          if (performance.now() - lastSpeechTimeRef.current > GATE_HOLD_MS) return;

          // Check if all peers can decode Opus
          let allPeersOpus = true;
          for (const caps of peerCapsRef.current.values()) {
            if (!caps.opus) { allPeersOpus = false; break; }
          }

          if (useOpus && encoder && encoder.state === 'configured' && allPeersOpus) {
            try {
              const audioData = new AudioData({
                format: 'f32-planar',
                sampleRate: nativeRate,
                numberOfFrames: pcm.length,
                numberOfChannels: 1,
                timestamp: frameTimestamp,
                data: pcm,
              });
              encoder.encode(audioData);
              audioData.close();
              frameTimestamp += 20000;
            } catch (e) {
              console.error('[Voice] Encode error:', e);
            }
          } else {
            // PCM fallback
            const int16 = new Int16Array(pcm.length);
            for (let i = 0; i < pcm.length; i++) {
              int16[i] = Math.max(-32768, Math.min(32767, (pcm[i] * 32767) | 0));
            }
            socket.volatile.emit('audio:chunk', {
              channelId: channelIdRef.current,
              data: int16.buffer,
              sampleRate: nativeRate,
            });
          }
        };
      } catch (err) {
        console.error('[Voice] Init error:', err);
      }

      if (cancelled) return;
      console.log('[Voice] Joining', channelId);
      const hasOpus = typeof AudioEncoder !== 'undefined' && typeof AudioDecoder !== 'undefined';
      socket.emit('voice:join', {
        channelId,
        capabilities: { opus: hasOpus },
      }, (response) => {
        if (response?.success && response.peers) {
          for (const peer of response.peers) {
            peerCapsRef.current.set(peer.socketId, peer.capabilities || {});
          }
          console.log('[Voice] Peer capabilities:', Object.fromEntries(peerCapsRef.current));
        }
      });
    }

    init();

    // ── Cleanup ──
    return () => {
      cancelled = true;

      socket.off('audio:chunk', handleAudioChunk);
      socket.off('voice:user-joined', handleUserJoined);
      socket.off('voice:user-left', handleUserLeft);
      socket.off('voice:speaking', handleSpeaking);

      playChime(playbackCtxRef, 'down');
      socket.emit('voice:leave', { channelId });

      if (encoderRef.current) {
        try { encoderRef.current.close(); } catch {}
        encoderRef.current = null;
      }
      for (const decoder of decodersRef.current.values()) {
        try { decoder.close(); } catch {}
      }
      decodersRef.current.clear();

      if (playbackNodeRef.current) {
        playbackNodeRef.current.port.postMessage({ clear: true });
        playbackNodeRef.current.disconnect();
        playbackNodeRef.current = null;
      }
      if (vadIntervalRef.current) clearInterval(vadIntervalRef.current);
      if (loopbackRef.current) {
        loopbackRef.current.disconnect();
        loopbackRef.current = null;
      }
      if (audioContextRef.current) audioContextRef.current.close();
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
        localStreamRef.current = null;
      }

      peerCapsRef.current.clear();
      wasSpeakingRef.current = false;
      lastSpeechTimeRef.current = 0;
      setSpeakingPeers(new Set());
      setPeerStates(new Map());
    };
  }, [channelId, socket]);

  const toggleMute = useCallback(() => {
    if (localStreamRef.current) {
      const track = localStreamRef.current.getAudioTracks()[0];
      if (track) {
        track.enabled = !track.enabled;
        const muted = !track.enabled;
        setIsMuted(muted);
        if (socket) {
          socket.emit('voice:muted', {
            channelId: channelIdRef.current,
            muted,
          });
        }
      }
    }
  }, [socket]);

  const toggleTest = useCallback(() => {
    if (!audioContextRef.current || !localStreamRef.current) return;
    if (loopbackRef.current) {
      loopbackRef.current.disconnect();
      loopbackRef.current = null;
      setTesting(false);
    } else {
      const source = audioContextRef.current.createMediaStreamSource(localStreamRef.current);
      const delay = audioContextRef.current.createDelay();
      delay.delayTime.value = 0.1;
      source.connect(delay);
      delay.connect(audioContextRef.current.destination);
      loopbackRef.current = source;
      setTesting(true);
    }
  }, []);

  return {
    isMuted,
    isSpeaking,
    micLevel,
    testing,
    toggleMute,
    toggleTest,
    speakingPeers,
    peerStates,
    sensitivity,
    setSensitivity,
  };
}
