import { useState, useEffect, useRef, useCallback } from 'react';
import { useSocket } from './useSocket.jsx';
import { loadRnnoise, RnnoiseDenoiser, denoiseFrame } from '../lib/rnnoise.js';

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
const MIN_NOISE_FLOOR = 3;

/**
 * Compute margin above adaptive noise floor from sensitivity slider (0–100).
 * Higher sensitivity → smaller margin → easier to trigger.
 *   sensitivity  0 → margin 25 (need to be very loud above noise)
 *   sensitivity 50 → margin 14
 *   sensitivity 100 → margin 3
 */
function computeMargin(sensitivity) {
  return Math.round(3 + 22 * (1 - sensitivity / 100));
}

function resampleCubic(input, fromRate, toRate) {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const outLen = Math.round(input.length / ratio);
  const output = new Float32Array(outLen);
  const last = input.length - 1;
  for (let i = 0; i < outLen; i++) {
    const srcIdx = i * ratio;
    const idx1 = Math.floor(srcIdx);
    const frac = srcIdx - idx1;
    // Catmull-Rom spline: 4-point interpolation
    const idx0 = Math.max(idx1 - 1, 0);
    const idx2 = Math.min(idx1 + 1, last);
    const idx3 = Math.min(idx1 + 2, last);
    const p0 = input[idx0], p1 = input[idx1], p2 = input[idx2], p3 = input[idx3];
    // Catmull-Rom coefficients
    const a = -0.5 * p0 + 1.5 * p1 - 1.5 * p2 + 0.5 * p3;
    const b = p0 - 2.5 * p1 + 2 * p2 - 0.5 * p3;
    const c = -0.5 * p0 + 0.5 * p2;
    const d = p1;
    output[i] = ((a * frac + b) * frac + c) * frac + d;
  }
  return output;
}

function resampleStereo(left, right, fromRate, toRate) {
  return {
    left: resampleCubic(left, fromRate, toRate),
    right: resampleCubic(right, fromRate, toRate),
  };
}

const sharingSupported = typeof navigator !== 'undefined' &&
  !!navigator.mediaDevices?.getDisplayMedia &&
  typeof AudioEncoder !== 'undefined' &&
  typeof AudioDecoder !== 'undefined';

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
  const [isSharing, setIsSharing] = useState(false);
  const [sharingUser, setSharingUser] = useState(null);
  const [musicVolume, setMusicVolumeState] = useState(() => {
    const saved = localStorage.getItem('disclone_music_volume');
    return saved !== null ? Number(saved) : 80;
  });
  const [shareVolume, setShareVolumeState] = useState(() => {
    const saved = localStorage.getItem('disclone_share_volume');
    return saved !== null ? Number(saved) : 100;
  });
  const [noiseSuppression, setNoiseSuppressionState] = useState(() => {
    const saved = localStorage.getItem('disclone_noise_suppression');
    return saved !== null ? saved === 'true' : true; // default ON
  });
  const [sensitivityMode, setSensitivityModeState] = useState(() => {
    const saved = localStorage.getItem('disclone_sensitivity_mode');
    return saved === 'manual' ? 'manual' : 'auto'; // default auto
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
  const musicStreamRef = useRef(null);
  const musicContextRef = useRef(null);
  const musicEncoderRef = useRef(null);
  const musicDecoderRef = useRef(null);
  const musicPlaybackNodeRef = useRef(null);
  const musicGainNodeRef = useRef(null);
  const shareGainNodeRef = useRef(null);
  const masterCompressorRef = useRef(null);
  const lastSeqRef = useRef(new Map());
  const lastPcmRef = useRef(new Map());
  const isSharingRef = useRef(false);
  const stopSharingRef = useRef(null);
  const noiseSuppressionRef = useRef(noiseSuppression);
  const rnnoiseRef = useRef(null);
  const peerDenoisersRef = useRef(new Map());
  const sensitivityModeRef = useRef(sensitivityMode);
  const vadProbAccRef = useRef({ sum: 0, count: 0 });
  const keepaliveAudioRef = useRef(null);
  const wakeLockRef = useRef(null);

  channelIdRef.current = channelId;
  isMutedRef.current = isMuted;
  sensitivityRef.current = sensitivity;
  isSharingRef.current = isSharing;
  noiseSuppressionRef.current = noiseSuppression;
  sensitivityModeRef.current = sensitivityMode;

  const setSensitivity = useCallback((val) => {
    const v = Math.max(0, Math.min(100, Math.round(val)));
    setSensitivityState(v);
    localStorage.setItem('disclone_voice_sensitivity', String(v));
  }, []);

  const setSensitivityMode = useCallback((mode) => {
    const m = mode === 'manual' ? 'manual' : 'auto';
    setSensitivityModeState(m);
    localStorage.setItem('disclone_sensitivity_mode', m);
  }, []);

  const setNoiseSuppression = useCallback(async (enabled) => {
    setNoiseSuppressionState(enabled);
    localStorage.setItem('disclone_noise_suppression', String(enabled));
    if (enabled && !rnnoiseRef.current) {
      try {
        const module = await loadRnnoise();
        rnnoiseRef.current = new RnnoiseDenoiser(module);
        console.log('[Voice] RNNoise denoiser loaded');
        // Create receive-side denoisers for all current peers
        for (const peerId of peerCapsRef.current.keys()) {
          if (!peerDenoisersRef.current.has(peerId)) {
            peerDenoisersRef.current.set(peerId, new RnnoiseDenoiser(module));
          }
        }
      } catch (e) {
        console.error('[Voice] Failed to load RNNoise:', e);
        setNoiseSuppressionState(false);
        localStorage.setItem('disclone_noise_suppression', 'false');
      }
    } else if (!enabled) {
      if (rnnoiseRef.current) {
        rnnoiseRef.current.destroy();
        rnnoiseRef.current = null;
      }
      // Destroy all peer denoisers
      for (const d of peerDenoisersRef.current.values()) d.destroy();
      peerDenoisersRef.current.clear();
      console.log('[Voice] RNNoise denoisers destroyed');
    }
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

      // ── Packet Loss Concealment (PLC) ──
      // Track sequence numbers per peer; repeat last frame for gaps
      function storePcmAndPLC(peerId, pcm, currentSeq) {
        const lastSeq = lastSeqRef.current.get(peerId);
        const lastPcm = lastPcmRef.current.get(peerId);
        if (lastSeq !== undefined && lastPcm && currentSeq > lastSeq + 1) {
          const missed = Math.min(currentSeq - lastSeq - 1, 6); // cap at 6 repeats
          for (let i = 0; i < missed; i++) {
            const gain = 1.0 - (i / 6) * 0.8; // progressive fadeout: 100% → 20%
            const repeated = new Float32Array(lastPcm.length);
            for (let j = 0; j < lastPcm.length; j++) {
              repeated[j] = lastPcm[j] * gain;
            }
            playNode.port.postMessage({ peerId, pcm: repeated }, [repeated.buffer]);
          }
        }
        lastSeqRef.current.set(peerId, currentSeq);
        lastPcmRef.current.set(peerId, new Float32Array(pcm));
        playNode.port.postMessage({ peerId, pcm }, [pcm.buffer]);
      }

      const currentSeq = seq || 0;

      if (codec === 'opus' && typeof AudioDecoder !== 'undefined') {
        let decoder = decodersRef.current.get(from);
        if (!decoder) {
          const playRate = playbackCtxRef.current?.sampleRate || 48000;
          decoder = new AudioDecoder({
            output: (audioData) => {
              try {
                // Extract seq from timestamp to avoid stale closure capture (Bug A fix)
                const decodedSeq = Math.round(audioData.timestamp / 20000);
                let pcm = new Float32Array(audioData.numberOfFrames);
                audioData.copyTo(pcm, { planeIndex: 0 });
                audioData.close();
                // Receive-side denoising (at 48kHz, before resample)
                if (noiseSuppressionRef.current) {
                  const peerDenoiser = peerDenoisersRef.current.get(from);
                  if (peerDenoiser) {
                    const { pcm: denoised } = denoiseFrame(peerDenoiser, pcm, 48000);
                    pcm = denoised;
                  }
                }
                if (playRate !== 48000) {
                  pcm = resampleCubic(pcm, 48000, playRate);
                }
                storePcmAndPLC(from, pcm, decodedSeq);
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
            timestamp: currentSeq * 20000,
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
        // Receive-side denoising (at source rate, before resample)
        if (noiseSuppressionRef.current) {
          const peerDenoiser = peerDenoisersRef.current.get(from);
          if (peerDenoiser) {
            const { pcm: denoised } = denoiseFrame(peerDenoiser, pcm, srcRate);
            pcm = denoised;
          }
        }
        if (srcRate !== playRate) {
          pcm = resampleCubic(pcm, srcRate, playRate);
        }
        storePcmAndPLC(from, pcm, currentSeq);
      }
    }

    // ── Socket event handlers ──

    function handleUserJoined({ socketId, capabilities }) {
      console.log(`[Voice] → user-joined: ${socketId}`, capabilities);
      if (capabilities) peerCapsRef.current.set(socketId, capabilities);
      // Eagerly create receive-side denoiser for this peer
      if (noiseSuppressionRef.current && !peerDenoisersRef.current.has(socketId)) {
        loadRnnoise().then((module) => {
          if (!peerDenoisersRef.current.has(socketId)) {
            peerDenoisersRef.current.set(socketId, new RnnoiseDenoiser(module));
          }
        }).catch(() => {});
      }
      playChime(playbackCtxRef, 'up');
    }

    function handleUserLeft({ socketId }) {
      console.log(`[Voice] → user-left: ${socketId}`);
      peerCapsRef.current.delete(socketId);
      lastSeqRef.current.delete(socketId);
      lastPcmRef.current.delete(socketId);
      // Destroy receive-side denoiser for this peer
      const peerDenoiser = peerDenoisersRef.current.get(socketId);
      if (peerDenoiser) {
        peerDenoiser.destroy();
        peerDenoisersRef.current.delete(socketId);
      }
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

    // ── Music sharing event handlers ──

    function handleMusicStarted({ socketId, username }) {
      setSharingUser({ socketId, username });
    }

    function handleMusicStopped() {
      setSharingUser(null);
      // Clear music playback buffer
      musicPlaybackNodeRef.current?.port.postMessage({ clear: true });
      // Close music decoder
      if (musicDecoderRef.current) {
        try { musicDecoderRef.current.close(); } catch { /* ignore */ }
        musicDecoderRef.current = null;
      }
    }

    function handleMusicChunk({ data, seq }) {
      const musicNode = musicPlaybackNodeRef.current;
      if (!musicNode) return;

      // Get or create stereo Opus decoder for music
      let decoder = musicDecoderRef.current;
      if (!decoder) {
        const playRate = playbackCtxRef.current?.sampleRate || 48000;
        decoder = new AudioDecoder({
          output: (audioData) => {
            try {
              const frames = audioData.numberOfFrames;
              let left = new Float32Array(frames);
              let right = new Float32Array(frames);
              audioData.copyTo(left, { planeIndex: 0 });
              if (audioData.numberOfChannels >= 2) {
                audioData.copyTo(right, { planeIndex: 1 });
              } else {
                right.set(left);
              }
              audioData.close();
              if (playRate !== 48000) {
                const resampled = resampleStereo(left, right, 48000, playRate);
                left = resampled.left;
                right = resampled.right;
              }
              musicNode.port.postMessage({ left, right }, [left.buffer, right.buffer]);
            } catch (e) {
              console.error('[Music] Decode output error:', e);
            }
          },
          error: (e) => {
            console.error('[Music] Decoder error:', e);
            musicDecoderRef.current = null;
          },
        });
        decoder.configure({ codec: 'opus', sampleRate: 48000, numberOfChannels: 2 });
        musicDecoderRef.current = decoder;
      }
      try {
        const chunk = new EncodedAudioChunk({
          type: 'key',
          timestamp: (seq || 0) * 20000,
          data,
        });
        decoder.decode(chunk);
      } catch (e) {
        console.error('[Music] Decode error:', e);
      }
    }

    socket.on('audio:chunk', handleAudioChunk);
    socket.on('voice:user-joined', handleUserJoined);
    socket.on('voice:user-left', handleUserLeft);
    socket.on('voice:speaking', handleSpeaking);
    socket.on('music:started', handleMusicStarted);
    socket.on('music:stopped', handleMusicStopped);
    socket.on('music:chunk', handleMusicChunk);

    // ── Init ──

    async function init() {
      try {
        // ── Master compressor for combined voice + music output ──
        const playCtx = playbackCtxRef.current;
        const masterCompressor = playCtx.createDynamicsCompressor();
        masterCompressor.threshold.value = -6;
        masterCompressor.knee.value = 6;
        masterCompressor.ratio.value = 3;
        masterCompressor.attack.value = 0.003;
        masterCompressor.release.value = 0.1;
        masterCompressor.connect(playCtx.destination);
        masterCompressorRef.current = masterCompressor;

        // ── Setup playback AudioWorklet ──
        await playCtx.audioWorklet.addModule('/playback-processor.js');
        const playbackNode = new AudioWorkletNode(playCtx, 'playback-processor');
        playbackNode.connect(masterCompressor);
        playbackNodeRef.current = playbackNode;

        // ── Setup music playback AudioWorklet ──
        await playCtx.audioWorklet.addModule('/music-playback-processor.js');
        const musicPlaybackNode = new AudioWorkletNode(playCtx, 'music-playback-processor', {
          outputChannelCount: [2],
        });
        const musicGain = playCtx.createGain();
        const savedVol = localStorage.getItem('disclone_music_volume');
        musicGain.gain.value = (savedVol !== null ? Number(savedVol) : 80) / 100;
        musicPlaybackNode.connect(musicGain);
        musicGain.connect(masterCompressor);
        musicPlaybackNodeRef.current = musicPlaybackNode;
        musicGainNodeRef.current = musicGain;

        if (cancelled) return;

        // ── Mobile keepalive: silent <audio> element ──
        // Mobile browsers (iOS/Android) suspend pages when the screen locks
        // UNLESS an HTMLAudioElement is actively playing. WebAudio alone isn't enough.
        // A looping silent audio clip tells the OS "this tab is playing media".
        try {
          // Tiny silent WAV: 1 sample, 8-bit mono, 8kHz (smallest valid WAV)
          const silentWav = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAESsAAABAAgAZGF0YQAAAAA=';
          const audio = new Audio(silentWav);
          audio.loop = true;
          audio.volume = 0.01; // near-silent but non-zero so OS doesn't skip it
          audio.setAttribute('playsinline', '');
          await audio.play().catch(() => {}); // may need user gesture on first call
          keepaliveAudioRef.current = audio;
        } catch { /* keepalive is best-effort */ }

        // ── Media Session API: show "Voice Chat" on lock screen ──
        if (navigator.mediaSession) {
          try {
            navigator.mediaSession.metadata = new MediaMetadata({
              title: 'Voice Chat',
              artist: channelId,
            });
            navigator.mediaSession.playbackState = 'playing';
          } catch { /* best-effort */ }
        }

        // ── Wake Lock API: prevent screen from auto-dimming ──
        if (navigator.wakeLock) {
          try {
            wakeLockRef.current = await navigator.wakeLock.request('screen');
          } catch { /* wake lock is best-effort */ }
        }

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
        // Minimal chain: HP filter for rumble, then straight to capture.
        // Browser's getUserMedia already provides echoCancellation + noiseSuppression + autoGainControl.
        // No lowpass (was 12kHz, muffled sibilants) and no compressor (caused pumping/feedback loops).
        const micSource = audioCtx.createMediaStreamSource(stream);

        const highPass = audioCtx.createBiquadFilter();
        highPass.type = 'highpass';
        highPass.frequency.value = 80;
        highPass.Q.value = 0.707;

        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.5;

        const captureNode = new AudioWorkletNode(audioCtx, 'capture-processor');

        // Chain: mic → HP → captureNode (pass-through) → analyser → silent output
        micSource.connect(highPass);
        highPass.connect(captureNode);
        captureNode.connect(analyser);
        const silentGain = audioCtx.createGain();
        silentGain.gain.value = 0.00001;
        analyser.connect(silentGain);
        silentGain.connect(audioCtx.destination);

        // ── Speech-weighted adaptive VAD ──
        // Only looks at 300Hz–3kHz (speech formant range). Ignores:
        //   - Low-freq rumble (chair, footsteps, HVAC)
        //   - High-freq hiss (fans, electronics)
        //   - Broadband transients outside speech band (keyboard clicks)
        // Adaptive noise floor tracks ambient level during silence,
        // so threshold auto-adjusts to the room.
        const binWidth = nativeRate / analyser.fftSize;
        const speechLowBin = Math.round(200 / binWidth);   // ~200Hz (captures male fundamentals)
        const speechHighBin = Math.floor(3000 / binWidth);  // ~3kHz
        const speechBinCount = speechHighBin - speechLowBin + 1;
        let noiseFloor = 10;
        let warmupFrames = 5; // First 500ms: minimum tracking to find ambient level
        let warmupMin = Infinity;

        const vadData = new Uint8Array(analyser.frequencyBinCount);
        vadIntervalRef.current = setInterval(() => {
          analyser.getByteFrequencyData(vadData);

          // Speech-band energy (200Hz–3kHz)
          let speechEnergy = 0;
          for (let i = speechLowBin; i <= speechHighBin; i++) {
            speechEnergy += vadData[i];
          }
          speechEnergy /= speechBinCount;

          // Full-band for mic level indicator
          let fullEnergy = 0;
          for (let i = 0; i < vadData.length; i++) fullEnergy += vadData[i];
          const avgLevel = fullEnergy / vadData.length;
          setMicLevel(Math.min(100, Math.round((avgLevel / 60) * 100)));

          // Adaptive noise floor
          if (warmupFrames > 0) {
            // Warmup: minimum tracking — captures ambient level on first frame,
            // ignores speech peaks. No false activations even during calibration.
            warmupMin = Math.min(warmupMin, speechEnergy);
            noiseFloor = Math.max(MIN_NOISE_FLOOR, warmupMin);
            warmupFrames--;
          } else if (!wasSpeakingRef.current) {
            // Steady state: slow EMA during silence only
            if (speechEnergy < noiseFloor) {
              noiseFloor = noiseFloor * 0.8 + speechEnergy * 0.2;
            } else {
              noiseFloor = noiseFloor * 0.97 + speechEnergy * 0.03;
            }
            noiseFloor = Math.max(MIN_NOISE_FLOOR, noiseFloor);
          }

          // Determine speaking state based on sensitivity mode
          let speaking;
          if (sensitivityModeRef.current === 'auto') {
            if (noiseSuppressionRef.current && rnnoiseRef.current) {
              // Auto + RNNoise: use neural VAD probability (averaged over interval)
              const acc = vadProbAccRef.current;
              const avgVadProb = acc.count > 0 ? acc.sum / acc.count : 0;
              vadProbAccRef.current = { sum: 0, count: 0 };
              speaking = avgVadProb > 0.5;
            } else {
              // Auto without RNNoise: adaptive VAD with moderate fixed margin
              speaking = speechEnergy > noiseFloor + 14; // margin equivalent to sensitivity 50
            }
          } else {
            // Manual mode: existing behavior
            const margin = computeMargin(sensitivityRef.current);
            speaking = speechEnergy > noiseFloor + margin;
          }

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

        // ── Eagerly load RNNoise if previously enabled ──
        if (noiseSuppressionRef.current && !rnnoiseRef.current) {
          loadRnnoise().then((module) => {
            if (!cancelled && !rnnoiseRef.current) {
              rnnoiseRef.current = new RnnoiseDenoiser(module);
              console.log('[Voice] RNNoise denoiser loaded (restored from settings)');
              // Create peer denoisers for any already-connected peers
              for (const peerId of peerCapsRef.current.keys()) {
                if (!peerDenoisersRef.current.has(peerId)) {
                  peerDenoisersRef.current.set(peerId, new RnnoiseDenoiser(module));
                }
              }
            }
          }).catch((e) => console.warn('[Voice] RNNoise load failed:', e));
        }

        // ── Handle frames from capture worklet ──
        let frameTimestamp = 0;
        let gateWasOpen = false;
        let fadeOutRemaining = 0;
        const FADE_OUT_FRAMES = 3; // 3 × 20ms = 60ms fade-out
        const FADE_IN_SAMPLES = Math.round(nativeRate * 0.005); // 5ms fade-in

        captureNode.port.onmessage = (e) => {
          if (isMutedRef.current || cancelled) return;
          let { pcm } = e.data;

          // Apply RNNoise denoising before VAD gate (cleaner input = better VAD)
          if (noiseSuppressionRef.current && rnnoiseRef.current) {
            const { pcm: denoised, vadProb } = denoiseFrame(rnnoiseRef.current, pcm, nativeRate);
            pcm = denoised;
            vadProbAccRef.current.sum += vadProb;
            vadProbAccRef.current.count++;
          }

          const gateOpen = performance.now() - lastSpeechTimeRef.current <= GATE_HOLD_MS;
          let frame;

          if (gateOpen) {
            if (!gateWasOpen) {
              // Gate just opened — fade-in to avoid click
              frame = new Float32Array(pcm.length);
              for (let i = 0; i < pcm.length; i++) {
                frame[i] = pcm[i] * (i < FADE_IN_SAMPLES ? i / FADE_IN_SAMPLES : 1);
              }
            } else {
              frame = pcm;
            }
            gateWasOpen = true;
            fadeOutRemaining = FADE_OUT_FRAMES;
          } else if (fadeOutRemaining > 0) {
            // Gate closed — smooth fade-out over remaining frames
            frame = new Float32Array(pcm.length);
            const startGain = fadeOutRemaining / (FADE_OUT_FRAMES + 1);
            const endGain = (fadeOutRemaining - 1) / (FADE_OUT_FRAMES + 1);
            for (let i = 0; i < pcm.length; i++) {
              const t = i / pcm.length;
              frame[i] = pcm[i] * (startGain + (endGain - startGain) * t);
            }
            fadeOutRemaining--;
            if (fadeOutRemaining === 0) gateWasOpen = false;
          } else {
            gateWasOpen = false;
            return;
          }

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
                numberOfFrames: frame.length,
                numberOfChannels: 1,
                timestamp: frameTimestamp,
                data: frame,
              });
              encoder.encode(audioData);
              audioData.close();
              frameTimestamp += 20000;
            } catch (e) {
              console.error('[Voice] Encode error:', e);
            }
          } else {
            // PCM fallback
            const int16 = new Int16Array(frame.length);
            for (let i = 0; i < frame.length; i++) {
              int16[i] = Math.max(-32768, Math.min(32767, (frame[i] * 32767) | 0));
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

    // ── Visibility change: resume audio + re-acquire wake lock on return ──
    function handleVisibilityChange() {
      if (document.visibilityState !== 'visible') return;
      // Resume AudioContexts that may have been suspended while backgrounded
      if (audioContextRef.current?.state === 'suspended') {
        audioContextRef.current.resume().catch(() => {});
      }
      if (playbackCtxRef.current?.state === 'suspended') {
        playbackCtxRef.current.resume().catch(() => {});
      }
      // Re-acquire wake lock (auto-released when page goes hidden)
      if (navigator.wakeLock && !wakeLockRef.current) {
        navigator.wakeLock.request('screen')
          .then((lock) => { wakeLockRef.current = lock; })
          .catch(() => {});
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // ── Cleanup ──
    return () => {
      cancelled = true;

      socket.off('audio:chunk', handleAudioChunk);
      socket.off('voice:user-joined', handleUserJoined);
      socket.off('voice:user-left', handleUserLeft);
      socket.off('voice:speaking', handleSpeaking);
      socket.off('music:started', handleMusicStarted);
      socket.off('music:stopped', handleMusicStopped);
      socket.off('music:chunk', handleMusicChunk);

      // Clean up music sharing if active
      if (isSharingRef.current) {
        socket.emit('music:stop', { channelId });
        setIsSharing(false);
        isSharingRef.current = false;
      }
      if (musicEncoderRef.current) {
        try { musicEncoderRef.current.close(); } catch { /* ignore */ }
        musicEncoderRef.current = null;
      }
      if (musicContextRef.current) {
        try { musicContextRef.current.close(); } catch { /* ignore */ }
        musicContextRef.current = null;
      }
      if (musicStreamRef.current) {
        musicStreamRef.current.getTracks().forEach((t) => t.stop());
        musicStreamRef.current = null;
      }
      if (musicDecoderRef.current) {
        try { musicDecoderRef.current.close(); } catch { /* ignore */ }
        musicDecoderRef.current = null;
      }
      if (musicPlaybackNodeRef.current) {
        musicPlaybackNodeRef.current.port.postMessage({ clear: true });
        musicPlaybackNodeRef.current.disconnect();
        musicPlaybackNodeRef.current = null;
      }
      if (musicGainNodeRef.current) {
        musicGainNodeRef.current.disconnect();
        musicGainNodeRef.current = null;
      }
      setSharingUser(null);

      // ── Clean up mobile keepalive ──
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (keepaliveAudioRef.current) {
        keepaliveAudioRef.current.pause();
        keepaliveAudioRef.current.src = '';
        keepaliveAudioRef.current = null;
      }
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {});
        wakeLockRef.current = null;
      }
      if (navigator.mediaSession) {
        try {
          navigator.mediaSession.metadata = null;
          navigator.mediaSession.playbackState = 'none';
        } catch { /* ignore */ }
      }

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

      if (rnnoiseRef.current) {
        rnnoiseRef.current.destroy();
        rnnoiseRef.current = null;
      }
      // Destroy all peer denoisers
      for (const d of peerDenoisersRef.current.values()) d.destroy();
      peerDenoisersRef.current.clear();

      if (masterCompressorRef.current) {
        masterCompressorRef.current.disconnect();
        masterCompressorRef.current = null;
      }
      shareGainNodeRef.current = null;
      lastSeqRef.current.clear();
      lastPcmRef.current.clear();
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

  const startSharing = useCallback(async () => {
    if (!socket || !channelIdRef.current || isSharingRef.current) return;

    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
    } catch (err) {
      // User cancelled the picker — silently return
      if (err.name === 'NotAllowedError') return;
      console.error('[Music] getDisplayMedia error:', err);
      return;
    }

    // Discard video track immediately
    for (const track of stream.getVideoTracks()) {
      track.stop();
    }

    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) {
      alert('The selected source has no audio. Please share a tab or window with audio.');
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

    try {
      const musicCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
      musicContextRef.current = musicCtx;

      await musicCtx.audioWorklet.addModule('/music-capture-processor.js');
      const captureNode = new AudioWorkletNode(musicCtx, 'music-capture-processor', {
        outputChannelCount: [2],
      });

      const source = musicCtx.createMediaStreamSource(stream);
      const shareGain = musicCtx.createGain();
      const savedShareVol = localStorage.getItem('disclone_share_volume');
      shareGain.gain.value = (savedShareVol !== null ? Number(savedShareVol) : 100) / 100;
      shareGainNodeRef.current = shareGain;
      const silentGain = musicCtx.createGain();
      silentGain.gain.value = 0.00001;
      source.connect(shareGain);
      shareGain.connect(captureNode);
      captureNode.connect(silentGain);
      silentGain.connect(musicCtx.destination);

      // Create stereo Opus encoder at 96kbps
      let musicSeq = 0;
      const encoder = new AudioEncoder({
        output: (chunk) => {
          const buf = new ArrayBuffer(chunk.byteLength);
          chunk.copyTo(buf);
          socket.volatile.emit('music:chunk', {
            channelId: channelIdRef.current,
            data: buf,
            seq: musicSeq++,
          });
        },
        error: (e) => console.error('[Music] Encoder error:', e),
      });
      encoder.configure({
        codec: 'opus',
        sampleRate: 48000,
        numberOfChannels: 2,
        bitrate: 96000,
      });
      musicEncoderRef.current = encoder;

      // Handle frames from capture worklet
      let frameTimestamp = 0;
      captureNode.port.onmessage = (e) => {
        const { left, right } = e.data;
        if (!left || !right) return;
        if (!musicEncoderRef.current || musicEncoderRef.current.state !== 'configured') return;
        try {
          // Interleave into planar AudioData (left plane then right plane)
          const planarData = new Float32Array(left.length + right.length);
          planarData.set(left, 0);
          planarData.set(right, left.length);
          const audioData = new AudioData({
            format: 'f32-planar',
            sampleRate: 48000,
            numberOfFrames: left.length,
            numberOfChannels: 2,
            timestamp: frameTimestamp,
            data: planarData,
          });
          encoder.encode(audioData);
          audioData.close();
          frameTimestamp += 20000;
        } catch (e) {
          console.error('[Music] Encode error:', e);
        }
      };

      musicStreamRef.current = stream;

      // Tell server we're sharing
      socket.emit('music:start', { channelId: channelIdRef.current }, (response) => {
        if (!response?.success) {
          // Failed — clean up
          alert(response?.error || 'Could not start sharing');
          encoder.close();
          musicCtx.close();
          stream.getTracks().forEach((t) => t.stop());
          musicStreamRef.current = null;
          musicContextRef.current = null;
          musicEncoderRef.current = null;
          return;
        }
        setIsSharing(true);
        isSharingRef.current = true;
        setSharingUser({ socketId: socket.id, username: 'You' });
      });

      // Auto-stop when the browser's "Stop sharing" bar is clicked
      audioTracks[0].addEventListener('ended', () => {
        stopSharingRef.current?.();
      });
    } catch (err) {
      console.error('[Music] Sharing init error:', err);
      stream.getTracks().forEach((t) => t.stop());
    }
  }, [socket]);

  const stopSharing = useCallback(() => {
    if (!socket) return;
    socket.emit('music:stop', { channelId: channelIdRef.current });

    if (musicEncoderRef.current) {
      try { musicEncoderRef.current.close(); } catch { /* ignore */ }
      musicEncoderRef.current = null;
    }
    if (musicContextRef.current) {
      try { musicContextRef.current.close(); } catch { /* ignore */ }
      musicContextRef.current = null;
    }
    if (musicStreamRef.current) {
      musicStreamRef.current.getTracks().forEach((t) => t.stop());
      musicStreamRef.current = null;
    }
    setIsSharing(false);
    isSharingRef.current = false;
    setSharingUser(null);
  }, [socket]);

  stopSharingRef.current = stopSharing;

  const setMusicVolume = useCallback((val) => {
    const v = Math.max(0, Math.min(100, Math.round(val)));
    setMusicVolumeState(v);
    localStorage.setItem('disclone_music_volume', String(v));
    if (musicGainNodeRef.current) {
      musicGainNodeRef.current.gain.value = v / 100;
    }
  }, []);

  const setShareVolume = useCallback((val) => {
    const v = Math.max(0, Math.min(100, Math.round(val)));
    setShareVolumeState(v);
    localStorage.setItem('disclone_share_volume', String(v));
    if (shareGainNodeRef.current) {
      shareGainNodeRef.current.gain.value = v / 100;
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
    sensitivityMode,
    setSensitivityMode,
    isSharing,
    sharingUser,
    startSharing,
    stopSharing,
    sharingSupported,
    musicVolume,
    setMusicVolume,
    shareVolume,
    setShareVolume,
    noiseSuppression,
    setNoiseSuppression,
  };
}
