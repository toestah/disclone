import { useState, useEffect, useRef, useCallback } from 'react';
import { useSocket } from './useSocket.jsx';
import { loadRnnoise, RnnoiseDenoiser } from '../lib/rnnoise.js';

// ── Constants ───────────────────────────────────────────────────

const MIN_NOISE_FLOOR = 3;
const VAD_POLL_MS = 50;

// Stereo pan positions for peers
const PAN_POSITIONS = [0, -0.4, 0.4, -0.2, 0.2, -0.6, 0.6, -0.1, 0.1, -0.5, 0.5];

const ICE_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

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
    const idx0 = Math.max(idx1 - 1, 0);
    const idx2 = Math.min(idx1 + 1, last);
    const idx3 = Math.min(idx1 + 2, last);
    const p0 = input[idx0], p1 = input[idx1], p2 = input[idx2], p3 = input[idx3];
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

// ── Silent WAV for mobile keepalive ─────────────────────────────
function generateSilentWavDataUri() {
  const rate = 8000, samples = 8000;
  const buf = new ArrayBuffer(44 + samples);
  const v = new DataView(buf);
  const s = (o, str) => { for (let i = 0; i < str.length; i++) v.setUint8(o + i, str.charCodeAt(i)); };
  s(0, 'RIFF'); v.setUint32(4, 36 + samples, true); s(8, 'WAVE');
  s(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
  s(36, 'data'); v.setUint32(40, samples, true);
  new Uint8Array(buf, 44).fill(128);
  let bin = ''; const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return 'data:audio/wav;base64,' + btoa(bin);
}
const SILENT_WAV_URI = generateSilentWavDataUri();

// ── SDP munging for Opus FEC + DTX + bitrate ────────────────────

function mungeOpusSDP(sdp) {
  const match = sdp.match(/a=rtpmap:(\d+) opus\/48000\/2/);
  if (!match) return sdp;
  const pt = match[1];
  const params = 'maxaveragebitrate=64000;useinbandfec=1;usedtx=1';
  const fmtpRegex = new RegExp(`a=fmtp:${pt} (.+)`);
  const fmtpMatch = sdp.match(fmtpRegex);
  if (fmtpMatch) {
    // Append to existing fmtp line
    return sdp.replace(fmtpRegex, `a=fmtp:${pt} ${fmtpMatch[1]};${params}`);
  }
  // Insert new fmtp line after rtpmap
  return sdp.replace(
    `a=rtpmap:${pt} opus/48000/2`,
    `a=rtpmap:${pt} opus/48000/2\r\na=fmtp:${pt} ${params}`
  );
}

// ── Hook ────────────────────────────────────────────────────────

export default function useVoice(channelId, playSound) {
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
    return saved !== null ? saved === 'true' : true;
  });
  const [sensitivityMode, setSensitivityModeState] = useState(() => {
    const saved = localStorage.getItem('disclone_sensitivity_mode');
    return saved === 'manual' ? 'manual' : 'auto';
  });

  // Screen sharing state
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [screenSharer, setScreenSharer] = useState(null); // { socketId, username } | null
  const [screenStream, setScreenStream] = useState(null); // remote MediaStream for viewer

  // Camera state
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [cameraStreams, setCameraStreams] = useState(new Map()); // peerId → MediaStream
  const [cameraUsers, setCameraUsers] = useState(new Set());

  // ── Refs ──
  const localStreamRef = useRef(null);
  const audioContextRef = useRef(null);
  const wasSpeakingRef = useRef(false);
  const loopbackRef = useRef(null);
  const channelIdRef = useRef(channelId);
  const playbackCtxRef = useRef(null);
  const isMutedRef = useRef(false);
  const sensitivityRef = useRef(sensitivity);
  const lastSpeechTimeRef = useRef(0);

  // WebRTC refs
  const peerConnectionsRef = useRef(new Map()); // peerId → RTCPeerConnection
  const remoteAudioNodesRef = useRef(new Map()); // peerId → { source, analyser, panner }
  const processedTrackRef = useRef(null);
  const vadGainRef = useRef(null);
  const vadIntervalRef = useRef(null);
  const peerCounterRef = useRef(0);
  const denoiseNodeRef = useRef(null);

  // Music refs (unchanged)
  const musicStreamRef = useRef(null);
  const musicContextRef = useRef(null);
  const musicEncoderRef = useRef(null);
  const musicDecoderRef = useRef(null);
  const musicPlaybackNodeRef = useRef(null);
  const musicGainNodeRef = useRef(null);
  const shareGainNodeRef = useRef(null);
  const masterCompressorRef = useRef(null);
  const musicPlanarBufRef = useRef(null);
  const isSharingRef = useRef(false);
  const stopSharingRef = useRef(null);
  const noiseSuppressionRef = useRef(noiseSuppression);
  const rnnoiseRef = useRef(null);
  const sensitivityModeRef = useRef(sensitivityMode);
  const musicAnalyserRef = useRef(null);
  const keepaliveAudioRef = useRef(null);
  const wakeLockRef = useRef(null);

  // Screen sharing refs
  const screenPCsRef = useRef(new Map()); // peerId → RTCPeerConnection (separate from audio PCs)
  const screenStreamRef = useRef(null); // local getDisplayMedia stream
  const isScreenSharingRef = useRef(false);
  const stopScreenSharingRef = useRef(null);

  // Camera refs
  const cameraPCsRef = useRef(new Map()); // peerId → RTCPeerConnection
  const cameraStreamRef = useRef(null); // local getUserMedia video stream
  const isCameraOnRef = useRef(false);
  const stopCameraRef = useRef(null);
  const createCameraOfferRef = useRef(null);

  // Keep refs in sync
  channelIdRef.current = channelId;
  isMutedRef.current = isMuted;
  sensitivityRef.current = sensitivity;
  isSharingRef.current = isSharing;
  noiseSuppressionRef.current = noiseSuppression;
  sensitivityModeRef.current = sensitivityMode;
  isScreenSharingRef.current = isScreenSharing;
  isCameraOnRef.current = isCameraOn;

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
    // Toggle browser-level noise suppression on the mic track
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (track) {
      try { await track.applyConstraints({ noiseSuppression: enabled }); } catch { /* ignore */ }
    }
    if (enabled) {
      // Load RNNoise first, THEN enable the denoise worklet
      if (!rnnoiseRef.current) {
        try {
          const module = await loadRnnoise();
          rnnoiseRef.current = new RnnoiseDenoiser(module);
          console.log('[Voice] RNNoise denoiser loaded');
        } catch (e) {
          console.error('[Voice] Failed to load RNNoise:', e);
          setNoiseSuppressionState(false);
          localStorage.setItem('disclone_noise_suppression', 'false');
          return;
        }
      }
      if (denoiseNodeRef.current) {
        denoiseNodeRef.current.port.postMessage({ enabled: true });
      }
    } else {
      // Disable worklet first (instant bypass), then cleanup RNNoise
      if (denoiseNodeRef.current) {
        denoiseNodeRef.current.port.postMessage({ enabled: false });
      }
      if (rnnoiseRef.current) {
        rnnoiseRef.current.destroy();
        rnnoiseRef.current = null;
      }
      console.log('[Voice] RNNoise denoiser disabled');
    }
  }, []);

  useEffect(() => {
    if (!channelId || !socket) return;
    let cancelled = false;
    let audioReady = false; // true once processedTrack + masterCompressor exist
    const pendingSignals = []; // queued signaling messages before audio is ready
    let iceConfig = ICE_CONFIG; // updated in init() with TURN servers from /api/ice-servers

    // Capture ref values for cleanup (avoids react-hooks/exhaustive-deps warnings)
    const peerConnections = peerConnectionsRef.current;
    const remoteAudioNodes = remoteAudioNodesRef.current;

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

    playSound?.('voiceJoin');

    // ── Socket event handlers ──

    function handleUserJoined({ socketId }) {
      console.log(`[Voice] → user-joined: ${socketId}`);
      playSound?.('userJoin');
      // Existing peer creates offer to new joiner (only if our audio is ready)
      if (audioReady && processedTrackRef.current) {
        createPeerConnection(socketId, true);
      } else {
        console.log(`[Voice] Queuing user-joined for ${socketId} (audio not ready)`);
        pendingSignals.push({ type: 'user-joined', msg: { socketId } });
      }
    }

    function handleUserLeft({ socketId }) {
      console.log(`[Voice] → user-left: ${socketId}`);
      playSound?.('userLeave');
      closePeerConnection(socketId);
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

    // ── WebRTC signaling handlers ──
    // Offers/answers/ICE candidates may arrive before getUserMedia completes
    // and the processed track exists. Queue them and flush after init finishes.

    function handleOffer(msg) {
      if (!audioReady) {
        console.log(`[Voice] ← webrtc:offer from ${msg.from} (queued — audio not ready)`);
        pendingSignals.push({ type: 'offer', msg });
        return;
      }
      console.log(`[Voice] ← webrtc:offer from ${msg.from}`);
      handleRemoteOffer(msg.from, msg.offer);
    }

    function handleAnswer({ from, answer }) {
      if (!audioReady) {
        pendingSignals.push({ type: 'answer', msg: { from, answer } });
        return;
      }
      console.log(`[Voice] ← webrtc:answer from ${from}`);
      const pc = peerConnectionsRef.current.get(from);
      if (!pc) return;
      pc.setRemoteDescription(new RTCSessionDescription(answer)).catch((e) => {
        console.error('[Voice] setRemoteDescription(answer) error:', e);
      });
    }

    function handleIceCandidate({ from, candidate }) {
      if (!audioReady) {
        pendingSignals.push({ type: 'ice', msg: { from, candidate } });
        return;
      }
      const pc = peerConnectionsRef.current.get(from);
      if (!pc) return;
      if (candidate) {
        pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
      }
    }

    function flushPendingSignals() {
      if (pendingSignals.length === 0) return;
      console.log(`[Voice] Flushing ${pendingSignals.length} queued signaling message(s)`);
      const queued = [...pendingSignals];
      pendingSignals.length = 0;
      for (const { type, msg } of queued) {
        if (type === 'offer') handleOffer(msg);
        else if (type === 'answer') handleAnswer(msg);
        else if (type === 'ice') handleIceCandidate(msg);
        else if (type === 'user-joined') handleUserJoined(msg);
      }
    }

    // ── Peer connection helpers ──

    function createPeerConnection(peerId, isOfferer) {
      if (peerConnectionsRef.current.has(peerId)) {
        closePeerConnection(peerId);
      }

      const pc = new RTCPeerConnection(iceConfig);
      peerConnectionsRef.current.set(peerId, pc);
      console.log(`[Voice] Creating PC for ${peerId} (offerer=${isOfferer})`);

      // Add our processed audio track
      const track = processedTrackRef.current;
      if (track) {
        pc.addTrack(track);
      }

      // ICE candidate relay
      pc.onicecandidate = (e) => {
        if (e.candidate) {
          socket.emit('webrtc:ice-candidate', {
            targetId: peerId,
            candidate: e.candidate.toJSON(),
          });
        }
      };

      // Remote audio track
      pc.ontrack = (e) => {
        console.log(`[Voice] ontrack from ${peerId}`);
        setupRemoteAudio(peerId, e.streams[0] || new MediaStream([e.track]));
      };

      // Connection state monitoring
      pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        console.log(`[Voice] PC ${peerId} state: ${state}`);
        if (state === 'failed' || state === 'disconnected') {
          closePeerConnection(peerId);
        }
      };

      if (isOfferer) {
        pc.createOffer().then((offer) => {
          offer.sdp = mungeOpusSDP(offer.sdp);
          return pc.setLocalDescription(offer);
        }).then(() => {
          socket.emit('webrtc:offer', {
            targetId: peerId,
            offer: pc.localDescription.toJSON(),
          });
        }).catch((e) => {
          console.error('[Voice] createOffer error:', e);
        });
      }

      return pc;
    }

    async function handleRemoteOffer(peerId, offer) {
      const pc = createPeerConnection(peerId, false);
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        answer.sdp = mungeOpusSDP(answer.sdp);
        await pc.setLocalDescription(answer);
        socket.emit('webrtc:answer', {
          targetId: peerId,
          answer: pc.localDescription.toJSON(),
        });
      } catch (e) {
        console.error('[Voice] handleRemoteOffer error:', e);
      }
    }

    function setupRemoteAudio(peerId, stream) {
      // Clean up any existing nodes for this peer
      cleanupRemoteAudio(peerId);

      const playCtx = playbackCtxRef.current;
      if (!playCtx || playCtx.state === 'closed') return;

      // Chrome requires a hidden <audio> element to activate the media pipeline
      // for remote WebRTC streams. Without this, MediaStreamSource produces silence.
      const audioEl = document.createElement('audio');
      audioEl.srcObject = stream;
      audioEl.volume = 0; // mute element — we route through Web Audio instead
      audioEl.play().catch(() => { /* ignore autoplay block */ });

      const source = playCtx.createMediaStreamSource(stream);
      const analyser = playCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.3;

      const panner = playCtx.createStereoPanner();
      const panIdx = peerCounterRef.current % PAN_POSITIONS.length;
      panner.pan.value = PAN_POSITIONS[panIdx];
      peerCounterRef.current++;

      source.connect(analyser);
      analyser.connect(panner);
      if (masterCompressorRef.current) {
        panner.connect(masterCompressorRef.current);
      } else {
        panner.connect(playCtx.destination);
      }

      remoteAudioNodesRef.current.set(peerId, { source, analyser, panner, stream, audioEl });
    }

    function cleanupRemoteAudio(peerId) {
      const nodes = remoteAudioNodesRef.current.get(peerId);
      if (!nodes) return;
      try { nodes.source.disconnect(); } catch { /* ignore */ }
      try { nodes.analyser.disconnect(); } catch { /* ignore */ }
      try { nodes.panner.disconnect(); } catch { /* ignore */ }
      if (nodes.audioEl) {
        nodes.audioEl.pause();
        nodes.audioEl.srcObject = null;
      }
      remoteAudioNodesRef.current.delete(peerId);
    }

    function closePeerConnection(peerId) {
      const pc = peerConnectionsRef.current.get(peerId);
      if (pc) {
        pc.onicecandidate = null;
        pc.ontrack = null;
        pc.onconnectionstatechange = null;
        pc.close();
        peerConnectionsRef.current.delete(peerId);
      }
      cleanupRemoteAudio(peerId);
    }

    // ── Lazy music playback worklet ──
    let musicWorkletPromise = null;
    async function ensureMusicPlayback() {
      if (musicPlaybackNodeRef.current) return musicPlaybackNodeRef.current;
      if (!musicWorkletPromise) {
        musicWorkletPromise = (async () => {
          const playCtx = playbackCtxRef.current;
          if (!playCtx || cancelled) return null;
          await playCtx.audioWorklet.addModule('/music-playback-processor.js');
          if (cancelled) return null;
          const node = new AudioWorkletNode(playCtx, 'music-playback-processor', {
            outputChannelCount: [2],
          });
          const gain = playCtx.createGain();
          const savedVol = localStorage.getItem('disclone_music_volume');
          gain.gain.value = (savedVol !== null ? Number(savedVol) : 80) / 100;
          const analyser = playCtx.createAnalyser();
          analyser.fftSize = 128;
          analyser.smoothingTimeConstant = 0.7;
          analyser.minDecibels = -90;
          analyser.maxDecibels = -10;
          node.connect(gain);
          gain.connect(analyser);
          analyser.connect(masterCompressorRef.current);
          musicAnalyserRef.current = analyser;
          musicPlaybackNodeRef.current = node;
          musicGainNodeRef.current = gain;
          return node;
        })();
      }
      return musicWorkletPromise;
    }

    // ── Music sharing event handlers ──

    function handleMusicStarted({ socketId, username, title }) {
      setSharingUser({ socketId, username, title: title || '' });
      ensureMusicPlayback();
    }

    function handleMusicTitle({ title }) {
      setSharingUser((prev) => prev ? { ...prev, title: title || '' } : prev);
    }

    function handleMusicStopped() {
      setSharingUser(null);
      musicPlaybackNodeRef.current?.port.postMessage({ clear: true });
      if (musicDecoderRef.current) {
        try { musicDecoderRef.current.close(); } catch { /* ignore */ }
        musicDecoderRef.current = null;
      }
    }

    async function handleMusicChunk({ data, seq }) {
      const musicNode = await ensureMusicPlayback();
      if (!musicNode || cancelled) return;

      let decoder = musicDecoderRef.current;
      if (!decoder) {
        const playRate = playbackCtxRef.current?.sampleRate || 48000;
        decoder = new AudioDecoder({
          output: (audioData) => {
            try {
              const frames = audioData.numberOfFrames;
              let left = new Float32Array(frames);
              let right = new Float32Array(frames);
              audioData.copyTo(left, { planeIndex: 0, format: 'f32-planar' });
              if (audioData.numberOfChannels >= 2) {
                audioData.copyTo(right, { planeIndex: 1, format: 'f32-planar' });
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

    // ── Screen sharing helpers ──

    function closeScreenPC(peerId) {
      const pc = screenPCsRef.current.get(peerId);
      if (pc) {
        pc.onicecandidate = null;
        pc.ontrack = null;
        pc.onconnectionstatechange = null;
        pc.close();
        screenPCsRef.current.delete(peerId);
      }
    }

    function closeAllScreenPCs() {
      for (const [peerId] of screenPCsRef.current) {
        closeScreenPC(peerId);
      }
      screenPCsRef.current.clear();
    }

    // Sharer side: create PC with screen tracks, send offer to viewer
    function createScreenOffer(viewerSocketId) {
      closeScreenPC(viewerSocketId);
      const stream = screenStreamRef.current;
      if (!stream) return;

      const pc = new RTCPeerConnection(iceConfig);
      screenPCsRef.current.set(viewerSocketId, pc);

      for (const track of stream.getTracks()) {
        pc.addTrack(track, stream);
      }

      pc.onicecandidate = (e) => {
        if (e.candidate) {
          socket.emit('screen:ice-candidate', {
            targetId: viewerSocketId,
            candidate: e.candidate.toJSON(),
          });
        }
      };

      pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        if (state === 'failed' || state === 'disconnected') {
          closeScreenPC(viewerSocketId);
        }
      };

      pc.createOffer().then((offer) => {
        return pc.setLocalDescription(offer);
      }).then(() => {
        socket.emit('screen:offer', {
          targetId: viewerSocketId,
          offer: pc.localDescription.toJSON(),
        });
        // Set initial max bitrate for video
        for (const sender of pc.getSenders()) {
          if (sender.track?.kind === 'video') {
            const params = sender.getParameters();
            if (!params.encodings) params.encodings = [{}];
            params.encodings[0].maxBitrate = 6_000_000;
            sender.setParameters(params).catch(() => {});
          }
        }
      }).catch((e) => {
        console.error('[Screen] createOffer error:', e);
      });
    }

    // Viewer side: handle offer from sharer, set ontrack to capture stream
    async function handleScreenRemoteOffer(sharerSocketId, offer) {
      closeScreenPC(sharerSocketId);

      const pc = new RTCPeerConnection(iceConfig);
      screenPCsRef.current.set(sharerSocketId, pc);

      pc.onicecandidate = (e) => {
        if (e.candidate) {
          socket.emit('screen:ice-candidate', {
            targetId: sharerSocketId,
            candidate: e.candidate.toJSON(),
          });
        }
      };

      pc.ontrack = (e) => {
        console.log('[Screen] ontrack from sharer', sharerSocketId);
        const stream = e.streams[0] || new MediaStream([e.track]);
        setScreenStream(stream);
      };

      pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        if (state === 'failed' || state === 'disconnected') {
          closeScreenPC(sharerSocketId);
          setScreenStream(null);
        }
      };

      try {
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('screen:answer', {
          targetId: sharerSocketId,
          answer: pc.localDescription.toJSON(),
        });
      } catch (e) {
        console.error('[Screen] handleRemoteOffer error:', e);
      }
    }

    // ── Screen sharing event handlers ──

    function handleScreenStarted({ socketId, username }) {
      setScreenSharer({ socketId, username });
    }

    function handleScreenStopped() {
      setScreenSharer(null);
      closeAllScreenPCs();
      setScreenStream(null);
    }

    function handleScreenViewerReady({ viewerSocketId }) {
      if (!isScreenSharingRef.current) return;
      createScreenOffer(viewerSocketId);
    }

    function handleScreenOffer({ from, offer }) {
      handleScreenRemoteOffer(from, offer);
    }

    function handleScreenAnswer({ from, answer }) {
      const pc = screenPCsRef.current.get(from);
      if (!pc) return;
      pc.setRemoteDescription(new RTCSessionDescription(answer)).catch((e) => {
        console.error('[Screen] setRemoteDescription(answer) error:', e);
      });
    }

    function handleScreenIceCandidate({ from, candidate }) {
      const pc = screenPCsRef.current.get(from);
      if (!pc) return;
      if (candidate) {
        pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
      }
    }

    // ── Camera (video) helpers ──

    function closeCameraPC(peerId) {
      const pc = cameraPCsRef.current.get(peerId);
      if (pc) {
        pc.onicecandidate = null;
        pc.ontrack = null;
        pc.onconnectionstatechange = null;
        pc.close();
        cameraPCsRef.current.delete(peerId);
      }
      setCameraStreams((prev) => {
        if (!prev.has(peerId)) return prev;
        const next = new Map(prev);
        next.delete(peerId);
        return next;
      });
    }

    function closeAllCameraPCs() {
      for (const [peerId] of cameraPCsRef.current) {
        closeCameraPC(peerId);
      }
      cameraPCsRef.current.clear();
      setCameraStreams(new Map());
    }

    function createCameraOfferTo(targetId) {
      closeCameraPC(targetId);
      const stream = cameraStreamRef.current;
      if (!stream) return;

      const pc = new RTCPeerConnection(iceConfig);
      cameraPCsRef.current.set(targetId, pc);

      for (const track of stream.getTracks()) {
        pc.addTrack(track, stream);
      }

      pc.onicecandidate = (e) => {
        if (e.candidate) {
          socket.emit('camera:ice-candidate', {
            targetId,
            candidate: e.candidate.toJSON(),
          });
        }
      };

      pc.ontrack = (e) => {
        const remoteStream = e.streams[0] || new MediaStream([e.track]);
        setCameraStreams((prev) => {
          const next = new Map(prev);
          next.set(targetId, remoteStream);
          return next;
        });
      };

      pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        if (state === 'failed' || state === 'disconnected') {
          closeCameraPC(targetId);
        }
      };

      pc.createOffer().then((offer) => {
        return pc.setLocalDescription(offer);
      }).then(() => {
        socket.emit('camera:offer', {
          targetId,
          offer: pc.localDescription.toJSON(),
        });
        // Limit video bitrate to 1.5 Mbps
        for (const sender of pc.getSenders()) {
          if (sender.track?.kind === 'video') {
            const params = sender.getParameters();
            if (!params.encodings) params.encodings = [{}];
            params.encodings[0].maxBitrate = 1_500_000;
            sender.setParameters(params).catch(() => {});
          }
        }
      }).catch((e) => {
        console.error('[Camera] createOffer error:', e);
      });
    }

    createCameraOfferRef.current = createCameraOfferTo;

    async function handleCameraRemoteOffer(fromId, offer) {
      closeCameraPC(fromId);

      const pc = new RTCPeerConnection(iceConfig);
      cameraPCsRef.current.set(fromId, pc);

      // Add own camera tracks if we also have camera on (bidirectional)
      const localStream = cameraStreamRef.current;
      if (localStream) {
        for (const track of localStream.getTracks()) {
          pc.addTrack(track, localStream);
        }
      }

      pc.onicecandidate = (e) => {
        if (e.candidate) {
          socket.emit('camera:ice-candidate', {
            targetId: fromId,
            candidate: e.candidate.toJSON(),
          });
        }
      };

      pc.ontrack = (e) => {
        const remoteStream = e.streams[0] || new MediaStream([e.track]);
        setCameraStreams((prev) => {
          const next = new Map(prev);
          next.set(fromId, remoteStream);
          return next;
        });
      };

      pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        if (state === 'failed' || state === 'disconnected') {
          closeCameraPC(fromId);
        }
      };

      try {
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('camera:answer', {
          targetId: fromId,
          answer: pc.localDescription.toJSON(),
        });
        // Limit video bitrate to 1.5 Mbps
        for (const sender of pc.getSenders()) {
          if (sender.track?.kind === 'video') {
            const params = sender.getParameters();
            if (!params.encodings) params.encodings = [{}];
            params.encodings[0].maxBitrate = 1_500_000;
            sender.setParameters(params).catch(() => {});
          }
        }
      } catch (e) {
        console.error('[Camera] handleRemoteOffer error:', e);
      }
    }

    // ── Camera event handlers ──

    function handleCameraUserStarted({ socketId, username }) {
      setCameraUsers((prev) => {
        const next = new Set(prev);
        next.add(socketId);
        return next;
      });
    }

    function handleCameraUserStopped({ socketId }) {
      setCameraUsers((prev) => {
        const next = new Set(prev);
        next.delete(socketId);
        return next;
      });
      closeCameraPC(socketId);
    }

    function handleCameraOffer({ from, offer }) {
      handleCameraRemoteOffer(from, offer);
    }

    function handleCameraAnswer({ from, answer }) {
      const pc = cameraPCsRef.current.get(from);
      if (!pc) return;
      pc.setRemoteDescription(new RTCSessionDescription(answer)).catch((e) => {
        console.error('[Camera] setRemoteDescription(answer) error:', e);
      });
    }

    function handleCameraIceCandidate({ from, candidate }) {
      const pc = cameraPCsRef.current.get(from);
      if (!pc) return;
      if (candidate) {
        pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
      }
    }

    // ── Register signaling listeners BEFORE voice:join ──
    socket.on('webrtc:offer', handleOffer);
    socket.on('webrtc:answer', handleAnswer);
    socket.on('webrtc:ice-candidate', handleIceCandidate);
    socket.on('voice:user-joined', handleUserJoined);
    socket.on('voice:user-left', handleUserLeft);
    socket.on('voice:speaking', handleSpeaking);
    socket.on('music:started', handleMusicStarted);
    socket.on('music:stopped', handleMusicStopped);
    socket.on('music:chunk', handleMusicChunk);
    socket.on('music:title', handleMusicTitle);
    socket.on('screen:started', handleScreenStarted);
    socket.on('screen:stopped', handleScreenStopped);
    socket.on('screen:viewer-ready', handleScreenViewerReady);
    socket.on('screen:offer', handleScreenOffer);
    socket.on('screen:answer', handleScreenAnswer);
    socket.on('screen:ice-candidate', handleScreenIceCandidate);
    socket.on('camera:user-started', handleCameraUserStarted);
    socket.on('camera:user-stopped', handleCameraUserStopped);
    socket.on('camera:offer', handleCameraOffer);
    socket.on('camera:answer', handleCameraAnswer);
    socket.on('camera:ice-candidate', handleCameraIceCandidate);

    // ── Init ──

    async function init() {
      // Fetch ICE servers (includes TURN if configured on server)
      try {
        const resp = await fetch('/api/ice-servers');
        if (resp.ok) {
          const servers = await resp.json();
          if (servers.length > 0) {
            iceConfig = { iceServers: servers };
            const hasTurn = servers.some(s => (Array.isArray(s.urls) ? s.urls : [s.urls]).some(u => u.startsWith('turn')));
            console.log(`[Voice] ICE servers: ${servers.length} (TURN: ${hasTurn ? 'yes' : 'no'})`);
          }
        }
      } catch (e) {
        console.warn('[Voice] TURN fetch failed, using STUN-only:', e);
      }
      if (cancelled) return;

      // Join the voice room on the server
      console.log('[Voice] Joining', channelId);
      const joinResponse = await new Promise((resolve) => {
        socket.emit('voice:join', { channelId }, resolve);
      });

      if (cancelled) return;
      const existingPeers = joinResponse?.peers || [];

      // Show jukebox if someone is already sharing
      if (joinResponse?.musicSharer) {
        setSharingUser(joinResponse.musicSharer);
      }

      // Show screen sharer if someone is already sharing screen
      if (joinResponse?.screenSharer) {
        setScreenSharer(joinResponse.screenSharer);
      }

      // Track existing camera users
      if (joinResponse?.cameraUsers?.length > 0) {
        setCameraUsers(new Set(joinResponse.cameraUsers.map((u) => u.socketId)));
      }

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

        // ── Mobile keepalive: silent <audio> element ──
        try {
          const audio = new Audio(SILENT_WAV_URI);
          audio.loop = true;
          audio.volume = 0.01;
          audio.setAttribute('playsinline', '');
          await audio.play().catch(() => {});
          keepaliveAudioRef.current = audio;
        } catch { /* keepalive is best-effort */ }
        if (cancelled) return;

        // ── Media Session API ──
        if (navigator.mediaSession) {
          try {
            navigator.mediaSession.metadata = new MediaMetadata({
              title: 'Voice Chat',
              artist: channelId,
            });
            navigator.mediaSession.playbackState = 'playing';
          } catch { /* best-effort */ }
        }

        // ── Wake Lock API ──
        if (navigator.wakeLock) {
          try {
            wakeLockRef.current = await navigator.wakeLock.request('screen');
          } catch { /* wake lock is best-effort */ }
        }
        if (cancelled) return;

        // ── Acquire mic ──
        if (!navigator.mediaDevices?.getUserMedia) {
          console.error('[Voice] getUserMedia not available');
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

        // Apply initial mute state
        const micTrack = stream.getAudioTracks()[0];
        if (micTrack) {
          micTrack.enabled = !isMutedRef.current;
        }

        // ── Local audio chain ──
        // mic → HP → presence → denoiseNode → analyser → vadGain → dest → WebRTC
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
        console.log('[Voice] AudioContext at', audioCtx.sampleRate, 'Hz');
        audioContextRef.current = audioCtx;

        const micSource = audioCtx.createMediaStreamSource(stream);

        const highPass = audioCtx.createBiquadFilter();
        highPass.type = 'highpass';
        highPass.frequency.value = 80;
        highPass.Q.value = 0.707;

        const presence = audioCtx.createBiquadFilter();
        presence.type = 'peaking';
        presence.frequency.value = 3000;
        presence.Q.value = 1.5;
        presence.gain.value = 2;

        // ── RNNoise denoise worklet ──
        // Processes audio through RNNoise WASM to remove background noise
        // (keyboard clicks, fan, etc.) from the signal itself — not just gating.
        await audioCtx.audioWorklet.addModule('/denoise-processor.js');
        const denoiseNode = new AudioWorkletNode(audioCtx, 'denoise-processor');
        denoiseNodeRef.current = denoiseNode;
        if (cancelled) return;

        // RNNoise processing on main thread (worklet posts 480-sample frames here)
        let latestRnnoiseVadProb = -1;
        denoiseNode.port.onmessage = (e) => {
          if (e.data.frame) {
            if (rnnoiseRef.current) {
              const { output, vadProb } = rnnoiseRef.current.processFrame(e.data.frame);
              latestRnnoiseVadProb = vadProb;
              const denoised = new Float32Array(480);
              denoised.set(output);
              denoiseNode.port.postMessage({ denoised }, [denoised.buffer]);
            } else {
              // RNNoise not loaded — pass frame back unchanged
              latestRnnoiseVadProb = -1;
              denoiseNode.port.postMessage({ denoised: e.data.frame }, [e.data.frame.buffer]);
            }
          }
        };

        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.5;

        // GainNode kept in chain for mute (always 1 — VAD no longer gates audio).
        // RNNoise denoises the signal; Opus DTX handles silence efficiently.
        // VAD is only used for the speaking indicator UI now.
        const vadGain = audioCtx.createGain();
        vadGain.gain.value = 1;
        vadGainRef.current = vadGain;

        // Output destination for WebRTC
        const dest = audioCtx.createMediaStreamDestination();
        const processedTrack = dest.stream.getAudioTracks()[0];
        processedTrackRef.current = processedTrack;

        // Chain: mic → HP → presence → denoiseNode → analyser → vadGain → dest
        micSource.connect(highPass);
        highPass.connect(presence);
        presence.connect(denoiseNode);
        denoiseNode.connect(analyser);
        analyser.connect(vadGain);
        vadGain.connect(dest);

        // Audio chain + masterCompressor are ready — flush any queued signaling
        audioReady = true;
        flushPendingSignals();

        // ── Eagerly load RNNoise if previously enabled ──
        if (noiseSuppressionRef.current && !rnnoiseRef.current) {
          loadRnnoise().then((module) => {
            if (!cancelled && !rnnoiseRef.current) {
              rnnoiseRef.current = new RnnoiseDenoiser(module);
              console.log('[Voice] RNNoise denoiser loaded (restored from settings)');
              // Enable the worklet now that RNNoise is ready
              if (denoiseNodeRef.current) {
                denoiseNodeRef.current.port.postMessage({ enabled: true });
              }
            }
          }).catch((e) => console.warn('[Voice] RNNoise load failed:', e));
        }

        // ── VAD polling ──
        const vadData = new Uint8Array(analyser.frequencyBinCount);
        const binWidth = audioCtx.sampleRate / analyser.fftSize;
        const speechLowBin = Math.round(200 / binWidth);
        const speechHighBin = Math.floor(3000 / binWidth);
        const speechBinCount = speechHighBin - speechLowBin + 1;
        let noiseFloor = 10;
        let warmupFrames = 5;
        let warmupMin = Infinity;
        let consecutiveSpeechFrames = 0;
        let micLevelCounter = 0;

        const vadInterval = setInterval(() => {
          if (cancelled) return;

          analyser.getByteFrequencyData(vadData);

          let speechEnergy = 0;
          for (let i = speechLowBin; i <= speechHighBin; i++) {
            speechEnergy += vadData[i];
          }
          speechEnergy /= speechBinCount;

          // Mic level indicator
          if (++micLevelCounter >= 2) { // ~100ms at 50ms intervals
            micLevelCounter = 0;
            let fullEnergy = 0;
            for (let i = 0; i < vadData.length; i++) fullEnergy += vadData[i];
            const avgLevel = fullEnergy / vadData.length;
            setMicLevel(Math.min(100, Math.round((avgLevel / 60) * 100)));
          }

          // Adaptive noise floor
          if (warmupFrames > 0) {
            warmupMin = Math.min(warmupMin, speechEnergy);
            noiseFloor = Math.max(MIN_NOISE_FLOOR, warmupMin);
            warmupFrames--;
          } else if (!wasSpeakingRef.current) {
            if (speechEnergy < noiseFloor) {
              noiseFloor = noiseFloor * 0.8 + speechEnergy * 0.2;
            } else {
              noiseFloor = noiseFloor * 0.97 + speechEnergy * 0.03;
            }
            noiseFloor = Math.max(MIN_NOISE_FLOOR, noiseFloor);
          }

          // RNNoise VAD probability (from denoise worklet chain — updated continuously)
          const rnnoiseVadProb = latestRnnoiseVadProb;

          // Determine speaking state
          let speaking;
          if (sensitivityModeRef.current === 'auto') {
            if (rnnoiseVadProb >= 0) {
              speaking = rnnoiseVadProb > 0.65;
            } else {
              speaking = speechEnergy > noiseFloor + 14;
            }
          } else {
            const margin = computeMargin(sensitivityRef.current);
            speaking = speechEnergy > noiseFloor + margin;
          }

          // Transient rejection
          if (speaking) {
            consecutiveSpeechFrames++;
          } else {
            consecutiveSpeechFrames = 0;
          }
          const confirmedSpeech = consecutiveSpeechFrames >= 2;

          if (confirmedSpeech) {
            lastSpeechTimeRef.current = performance.now();
          }
          if (confirmedSpeech !== wasSpeakingRef.current) {
            wasSpeakingRef.current = confirmedSpeech;
            setIsSpeaking(confirmedSpeech);
            socket.emit('voice:speaking', {
              channelId: channelIdRef.current,
              speaking: confirmedSpeech,
            });
          }

        }, VAD_POLL_MS);

        vadIntervalRef.current = vadInterval;

        if (cancelled) return;

        // ── Remote speaking detection polling ──
        const remoteSpeakingInterval = setInterval(() => {
          if (cancelled) return;
          for (const [peerId, nodes] of remoteAudioNodesRef.current) {
            const data = new Uint8Array(nodes.analyser.frequencyBinCount);
            nodes.analyser.getByteFrequencyData(data);
            let energy = 0;
            for (let i = 0; i < data.length; i++) energy += data[i];
            const avg = energy / data.length;
            const isSpeakingNow = avg > 15;
            setSpeakingPeers((prev) => {
              const has = prev.has(peerId);
              if (isSpeakingNow === has) return prev;
              const s = new Set(prev);
              if (isSpeakingNow) s.add(peerId);
              else s.delete(peerId);
              return s;
            });
          }
        }, 100);

        // ── Create peer connections for existing peers ──
        for (const peer of existingPeers) {
          // We're the new joiner — existing peers will send offers to us
          // We don't create offers ourselves (avoids glare)
          console.log(`[Voice] Waiting for offer from existing peer ${peer.socketId}`);
        }

        // ── Cleanup additions ──
        const originalCleanup = () => {
          clearInterval(vadInterval);
          clearInterval(remoteSpeakingInterval);
        };

        // Store for cleanup
        vadIntervalRef.current = { vadInterval, remoteSpeakingInterval, cleanup: originalCleanup };
      } catch (err) {
        console.error('[Voice] Init error:', err);
      }
    }

    init();

    // ── Visibility change ──
    function handleVisibilityChange() {
      if (document.visibilityState !== 'visible') return;
      if (audioContextRef.current?.state === 'suspended') {
        audioContextRef.current.resume().catch(() => {});
      }
      if (playbackCtxRef.current?.state === 'suspended') {
        playbackCtxRef.current.resume().catch(() => {});
      }
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

      socket.off('webrtc:offer', handleOffer);
      socket.off('webrtc:answer', handleAnswer);
      socket.off('webrtc:ice-candidate', handleIceCandidate);
      socket.off('voice:user-joined', handleUserJoined);
      socket.off('voice:user-left', handleUserLeft);
      socket.off('voice:speaking', handleSpeaking);
      socket.off('music:started', handleMusicStarted);
      socket.off('music:stopped', handleMusicStopped);
      socket.off('music:chunk', handleMusicChunk);
      socket.off('music:title', handleMusicTitle);
      socket.off('screen:started', handleScreenStarted);
      socket.off('screen:stopped', handleScreenStopped);
      socket.off('screen:viewer-ready', handleScreenViewerReady);
      socket.off('screen:offer', handleScreenOffer);
      socket.off('screen:answer', handleScreenAnswer);
      socket.off('screen:ice-candidate', handleScreenIceCandidate);
      socket.off('camera:user-started', handleCameraUserStarted);
      socket.off('camera:user-stopped', handleCameraUserStopped);
      socket.off('camera:offer', handleCameraOffer);
      socket.off('camera:answer', handleCameraAnswer);
      socket.off('camera:ice-candidate', handleCameraIceCandidate);

      // Clean up screen sharing if active
      if (isScreenSharingRef.current) {
        socket.emit('screen:stop', { channelId });
        setIsScreenSharing(false);
        isScreenSharingRef.current = false;
      }
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach((t) => t.stop());
        screenStreamRef.current = null;
      }
      closeAllScreenPCs();
      setScreenSharer(null);
      setScreenStream(null);

      // Clean up camera if active
      if (isCameraOnRef.current) {
        socket.emit('camera:stop', { channelId });
        setIsCameraOn(false);
        isCameraOnRef.current = false;
      }
      if (cameraStreamRef.current) {
        cameraStreamRef.current.getTracks().forEach((t) => t.stop());
        cameraStreamRef.current = null;
      }
      closeAllCameraPCs();
      setCameraUsers(new Set());

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
      musicAnalyserRef.current = null;
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

      playSound?.('disconnect');
      socket.emit('voice:leave', { channelId });

      // ── Close all peer connections ──
      for (const [, pc] of peerConnections) {
        pc.onicecandidate = null;
        pc.ontrack = null;
        pc.onconnectionstatechange = null;
        pc.close();
      }
      peerConnections.clear();

      // ── Disconnect all remote audio nodes ──
      for (const [, nodes] of remoteAudioNodes) {
        try { nodes.source.disconnect(); } catch { /* ignore */ }
        try { nodes.analyser.disconnect(); } catch { /* ignore */ }
        try { nodes.panner.disconnect(); } catch { /* ignore */ }
        if (nodes.audioEl) {
          nodes.audioEl.pause();
          nodes.audioEl.srcObject = null;
        }
      }
      remoteAudioNodes.clear();
      peerCounterRef.current = 0;

      // ── Clear intervals ──
      if (vadIntervalRef.current) {
        if (vadIntervalRef.current.cleanup) {
          vadIntervalRef.current.cleanup();
        } else {
          clearInterval(vadIntervalRef.current);
        }
        vadIntervalRef.current = null;
      }

      // ── Stop processed track ──
      if (processedTrackRef.current) {
        processedTrackRef.current.stop();
        processedTrackRef.current = null;
      }

      if (denoiseNodeRef.current) {
        denoiseNodeRef.current.port.close();
        denoiseNodeRef.current.disconnect();
        denoiseNodeRef.current = null;
      }
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

      if (masterCompressorRef.current) {
        masterCompressorRef.current.disconnect();
        masterCompressorRef.current = null;
      }
      shareGainNodeRef.current = null;
      musicPlanarBufRef.current = null;
      vadGainRef.current = null;
      wasSpeakingRef.current = false;
      lastSpeechTimeRef.current = 0;
      setSpeakingPeers(new Set());
      setPeerStates(new Map());
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId, socket]);

  const toggleMute = useCallback(() => {
    if (localStreamRef.current) {
      const track = localStreamRef.current.getAudioTracks()[0];
      if (track) {
        track.enabled = !track.enabled;
        const muted = !track.enabled;
        setIsMuted(muted);
        playSound?.(muted ? 'mute' : 'unmute');
        if (socket) {
          socket.emit('voice:muted', {
            channelId: channelIdRef.current,
            muted,
          });
        }
      }
    }
  }, [socket, playSound]);

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
      stream = await navigator.mediaDevices.getDisplayMedia({
        audio: true,
        video: true,
      });
    } catch (err) {
      if (err.name === 'NotAllowedError') return;
      console.error('[Music] getDisplayMedia error:', err);
      return;
    }

    let shareTitle = '';
    const videoTracks = stream.getVideoTracks();
    if (videoTracks.length > 0) {
      const label = videoTracks[0].label || '';
      const generic = /^(screen:|entire screen|window:|web-contents-media-stream:|:\/\/|$)/i;
      if (label && !generic.test(label)) {
        shareTitle = label;
      }
    }
    for (const track of videoTracks) {
      track.stop();
    }

    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) {
      alert(
        'No audio track found.\n\n' +
        'To share audio:\n' +
        '1. Select a Chrome TAB (not a window or screen)\n' +
        '2. Make sure "Share tab audio" is checked\n\n' +
        'Note: On macOS, only tab sharing supports audio.'
      );
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
      const shareAnalyser = musicCtx.createAnalyser();
      shareAnalyser.fftSize = 128;
      shareAnalyser.smoothingTimeConstant = 0.7;
      shareAnalyser.minDecibels = -90;
      shareAnalyser.maxDecibels = -10;
      source.connect(shareGain);
      shareGain.connect(shareAnalyser);
      shareAnalyser.connect(captureNode);
      musicAnalyserRef.current = shareAnalyser;
      captureNode.connect(silentGain);
      silentGain.connect(musicCtx.destination);

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

      let frameTimestamp = 0;
      captureNode.port.onmessage = (e) => {
        const { left, right } = e.data;
        if (!left || !right) return;
        if (!musicEncoderRef.current || musicEncoderRef.current.state !== 'configured') return;
        try {
          const totalLen = left.length + right.length;
          let planarData = musicPlanarBufRef.current;
          if (!planarData || planarData.length !== totalLen) {
            planarData = new Float32Array(totalLen);
            musicPlanarBufRef.current = planarData;
          }
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

      socket.emit('music:start', { channelId: channelIdRef.current, title: shareTitle }, (response) => {
        if (!response?.success) {
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
        setSharingUser({ socketId: socket.id, username: 'You', title: shareTitle });
      });

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
    musicAnalyserRef.current = null;
    setIsSharing(false);
    isSharingRef.current = false;
    setSharingUser(null);
  }, [socket]);

  stopSharingRef.current = stopSharing;

  // ── Screen sharing callbacks ──

  const screenShareSupported = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;

  const startScreenShare = useCallback(async () => {
    if (!socket || !channelIdRef.current || isScreenSharingRef.current) return;

    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 60 } },
        audio: true,
      });
    } catch (err) {
      if (err.name === 'NotAllowedError') return;
      console.error('[Screen] getDisplayMedia error:', err);
      return;
    }

    // Set content hint for gaming optimization
    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
      try { videoTrack.contentHint = 'motion'; } catch { /* ignore */ }
    }

    screenStreamRef.current = stream;

    socket.emit('screen:start', { channelId: channelIdRef.current }, (response) => {
      if (!response?.success) {
        alert(response?.error || 'Could not start screen sharing');
        stream.getTracks().forEach((t) => t.stop());
        screenStreamRef.current = null;
        return;
      }
      setIsScreenSharing(true);
      isScreenSharingRef.current = true;
      setScreenSharer({ socketId: socket.id, username: 'You' });
    });

    // Listen for browser "Stop sharing" button
    if (videoTrack) {
      videoTrack.addEventListener('ended', () => {
        stopScreenSharingRef.current?.();
      });
    }
  }, [socket]);

  const stopScreenShare = useCallback(() => {
    if (!socket) return;
    socket.emit('screen:stop', { channelId: channelIdRef.current });

    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
    }
    // Close all screen PCs (viewers' connections)
    for (const [, pc] of screenPCsRef.current) {
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      pc.close();
    }
    screenPCsRef.current.clear();

    setIsScreenSharing(false);
    isScreenSharingRef.current = false;
    setScreenSharer(null);
  }, [socket]);

  stopScreenSharingRef.current = stopScreenShare;

  const watchScreen = useCallback((sharerSocketId) => {
    if (!socket) return;
    socket.emit('screen:watch', { sharerSocketId });
  }, [socket]);

  const stopWatching = useCallback(() => {
    for (const [, pc] of screenPCsRef.current) {
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      pc.close();
    }
    screenPCsRef.current.clear();
    setScreenStream(null);
  }, []);

  // ── Camera (video) callbacks ──

  const cameraSupported = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

  const startCamera = useCallback(async () => {
    if (!socket || !channelIdRef.current || isCameraOnRef.current) return;

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
      });
    } catch (err) {
      if (err.name === 'NotAllowedError') return;
      console.error('[Camera] getUserMedia error:', err);
      return;
    }

    cameraStreamRef.current = stream;

    socket.emit('camera:start', { channelId: channelIdRef.current }, (response) => {
      if (!response?.success) {
        alert(response?.error || 'Could not start camera');
        stream.getTracks().forEach((t) => t.stop());
        cameraStreamRef.current = null;
        return;
      }
      setIsCameraOn(true);
      isCameraOnRef.current = true;

      // Create offers to all peers in the room that have camera on
      // (also offer to all peers so they can see us even if their camera is off)
      const voiceRoom = peerConnectionsRef.current;
      for (const [peerId] of voiceRoom) {
        createCameraOfferRef.current?.(peerId);
      }
    });

    // Stop camera if video track ends (e.g., browser UI or permission revocation)
    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.addEventListener('ended', () => {
        stopCameraRef.current?.();
      });
    }
  }, [socket]);

  const stopCamera = useCallback(() => {
    if (!socket) return;
    socket.emit('camera:stop', { channelId: channelIdRef.current });

    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((t) => t.stop());
      cameraStreamRef.current = null;
    }
    for (const [, pc] of cameraPCsRef.current) {
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      pc.close();
    }
    cameraPCsRef.current.clear();
    setCameraStreams(new Map());

    setIsCameraOn(false);
    isCameraOnRef.current = false;
  }, [socket]);

  stopCameraRef.current = stopCamera;

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
    musicAnalyserRef,
    isScreenSharing,
    screenSharer,
    screenStream,
    startScreenShare,
    stopScreenShare,
    watchScreen,
    stopWatching,
    screenShareSupported,
    isCameraOn,
    cameraStreams,
    cameraUsers,
    cameraStreamRef,
    startCamera,
    stopCamera,
    cameraSupported,
  };
}
