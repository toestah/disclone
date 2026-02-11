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

const CAPTURE_BUFFER = 2048;       // ~43ms chunks at 48 kHz
const JITTER_BUFFER_S = 0.1;       // 100ms initial playback buffer
const CROSSFADE_S = 0.003;         // 3ms crossfade between chunks
const GATE_HOLD_MS = 300;          // Keep gate open 300ms after speech stops

// ── Helpers ─────────────────────────────────────────────────────

function computeThreshold(sensitivity) {
  // sensitivity 0   → threshold 60 (strict — filters most sounds)
  // sensitivity 50  → threshold ~13 (reasonable default)
  // sensitivity 100 → threshold 2  (sensitive — passes most sounds)
  return Math.max(2, Math.round(60 * Math.pow(0.97, sensitivity)));
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
  const nextPlayTimeRef = useRef(new Map());
  const sensitivityRef = useRef(sensitivity);
  const lastSpeechTimeRef = useRef(0);

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

    function handleAudioChunk({ from, data, sampleRate }) {
      const ctx = playbackCtxRef.current;
      if (!ctx || ctx.state === 'closed') return;
      if (ctx.state === 'suspended') ctx.resume();

      // Decode Int16 → Float32
      const int16 = new Int16Array(data);
      const float32 = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) {
        float32[i] = int16[i] / 32768;
      }

      const rate = sampleRate || 48000;
      const buffer = ctx.createBuffer(1, float32.length, rate);
      buffer.getChannelData(0).set(float32);

      const source = ctx.createBufferSource();
      source.buffer = buffer;

      // Schedule with jitter absorption
      const now = ctx.currentTime;
      let t = nextPlayTimeRef.current.get(from);

      if (t === undefined) {
        t = now + JITTER_BUFFER_S;
      } else if (t < now - 0.15) {
        // Fallen too far behind — snap forward
        t = now + 0.03;
      }

      const startTime = Math.max(t, now);

      // Crossfade envelope — eliminates clicks at chunk boundaries.
      // Adjacent chunks overlap by `fade` seconds. Linear fade-out of
      // the old chunk + linear fade-in of the new chunk sums to unity
      // at every point, so no volume dip.
      const fade = CROSSFADE_S;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(1, startTime + fade);
      const endTime = startTime + buffer.duration;
      gain.gain.setValueAtTime(1, endTime - fade);
      gain.gain.linearRampToValueAtTime(0, endTime);

      source.connect(gain);
      gain.connect(ctx.destination);
      source.start(startTime);

      // Overlap next chunk by fade time for smooth crossfade
      nextPlayTimeRef.current.set(from, startTime + buffer.duration - fade);
    }

    // ── Socket event handlers ──

    function handleUserJoined({ socketId }) {
      console.log(`[Voice] → user-joined: ${socketId}`);
      playChime(playbackCtxRef, 'up');
    }

    function handleUserLeft({ socketId }) {
      console.log(`[Voice] → user-left: ${socketId}`);
      playChime(playbackCtxRef, 'down');
      nextPlayTimeRef.current.delete(socketId);
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

    // ── Init: acquire mic → build processing chain → join ──

    async function init() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          console.error('[Voice] getUserMedia not available');
          socket.emit('voice:join', { channelId });
          return;
        }

        console.log('[Voice] Requesting microphone...');
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        localStreamRef.current = stream;

        // Use device default sample rate — forcing a rate causes
        // ScriptProcessor to misbehave (pitch-shift bugs).
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const nativeRate = audioCtx.sampleRate;
        console.log('[Voice] AudioContext at', nativeRate, 'Hz');
        audioContextRef.current = audioCtx;

        const micSource = audioCtx.createMediaStreamSource(stream);

        // ── Voice processing chain ──
        //
        // mic → highPass(80Hz)  — removes rumble, AC hum, handling noise
        //     → lowPass(12kHz)  — removes hiss, high-freq artifacts
        //     → compressor      — evens out volume, prevents clipping
        //     → analyser (VAD)
        //     → scriptProcessor (capture + inline VAD gate)

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

        // Wire the chain
        micSource.connect(highPass);
        highPass.connect(lowPass);
        lowPass.connect(compressor);
        compressor.connect(analyser);

        // VAD interval — updates UI (speaking indicators, mic level)
        const vadData = new Uint8Array(analyser.frequencyBinCount);
        vadIntervalRef.current = setInterval(() => {
          analyser.getByteFrequencyData(vadData);
          let sum = 0;
          for (let i = 0; i < vadData.length; i++) sum += vadData[i];
          const avg = sum / vadData.length;
          const threshold = computeThreshold(sensitivityRef.current);
          const speaking = avg > threshold;
          setMicLevel(Math.min(100, Math.round((avg / 60) * 100)));

          if (speaking !== wasSpeakingRef.current) {
            wasSpeakingRef.current = speaking;
            setIsSpeaking(speaking);
            socket.emit('voice:speaking', {
              channelId: channelIdRef.current,
              speaking,
            });
          }
        }, 100);

        // ── Audio capture with VAD noise gate ──
        const processor = audioCtx.createScriptProcessor(CAPTURE_BUFFER, 1, 1);
        const gateVadData = new Uint8Array(analyser.frequencyBinCount);

        processor.onaudioprocess = (e) => {
          if (isMutedRef.current || cancelled) return;

          const input = e.inputBuffer.getChannelData(0);

          // Skip true silence (saves CPU on the gate check)
          let peak = 0;
          for (let i = 0; i < input.length; i++) {
            const a = Math.abs(input[i]);
            if (a > peak) peak = a;
          }
          if (peak < 0.001) return;

          // ── VAD noise gate ──
          // Uses spectral analysis (not just amplitude) so it
          // distinguishes speech from keyboard clicks / mouse noise.
          analyser.getByteFrequencyData(gateVadData);
          let sum = 0;
          for (let i = 0; i < gateVadData.length; i++) sum += gateVadData[i];
          const avg = sum / gateVadData.length;

          const threshold = computeThreshold(sensitivityRef.current);
          if (avg > threshold) {
            lastSpeechTimeRef.current = performance.now();
          }

          // Gate closed — no speech detected recently
          if (performance.now() - lastSpeechTimeRef.current > GATE_HOLD_MS) return;

          // Encode Float32 → Int16 at native rate (no resampling)
          const int16 = new Int16Array(input.length);
          for (let i = 0; i < input.length; i++) {
            int16[i] = Math.max(-32768, Math.min(32767, (input[i] * 32767) | 0));
          }

          socket.volatile.emit('audio:chunk', {
            channelId: channelIdRef.current,
            data: int16.buffer,
            sampleRate: nativeRate,
          });
        };

        // Connect processor (needs a connected output to fire)
        compressor.connect(processor);
        const silentGain = audioCtx.createGain();
        silentGain.gain.value = 0;
        processor.connect(silentGain);
        silentGain.connect(audioCtx.destination);
      } catch (err) {
        console.error('[Voice] Mic error:', err);
      }

      if (cancelled) return;

      console.log('[Voice] Joining', channelId);
      socket.emit('voice:join', { channelId });
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

      nextPlayTimeRef.current.clear();
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
      const source = audioContextRef.current.createMediaStreamSource(
        localStreamRef.current
      );
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
