import { useState, useEffect, useRef, useCallback } from 'react';
import SimplePeer from 'simple-peer';
import { useSocket } from './useSocket.jsx';

export default function useVoice(channelId) {
  const { socket } = useSocket();
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [speakingPeers, setSpeakingPeers] = useState(new Set());
  const [testing, setTesting] = useState(false);

  const localStreamRef = useRef(null);
  const peersRef = useRef(new Map());
  const audioContextRef = useRef(null);
  const vadIntervalRef = useRef(null);
  const wasSpeakingRef = useRef(false);
  const audioElementsRef = useRef(new Map());
  const loopbackRef = useRef(null);
  const channelIdRef = useRef(channelId);

  channelIdRef.current = channelId;

  useEffect(() => {
    if (!channelId || !socket) return;

    let cancelled = false;

    function createPeer(remoteSocketId, initiator) {
      // Destroy existing peer if any
      const existing = peersRef.current.get(remoteSocketId);
      if (existing) {
        existing.destroy();
        peersRef.current.delete(remoteSocketId);
      }

      const peer = new SimplePeer({
        initiator,
        stream: localStreamRef.current || undefined,
        trickle: true,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            {
              urls: 'turn:openrelay.metered.ca:80',
              username: 'openrelayproject',
              credential: 'openrelayproject',
            },
            {
              urls: 'turn:openrelay.metered.ca:443',
              username: 'openrelayproject',
              credential: 'openrelayproject',
            },
          ],
        },
      });

      peer.on('signal', (signal) => {
        if (signal.type === 'offer') {
          socket.emit('webrtc:offer', { to: remoteSocketId, signal });
        } else if (signal.type === 'answer') {
          socket.emit('webrtc:answer', { to: remoteSocketId, signal });
        } else {
          socket.emit('webrtc:ice-candidate', { to: remoteSocketId, signal });
        }
      });

      peer.on('stream', (remoteStream) => {
        const audio = new Audio();
        audio.srcObject = remoteStream;
        audio.play().catch((e) => console.warn('Audio autoplay blocked:', e));
        audioElementsRef.current.set(remoteSocketId, audio);
      });

      peer.on('error', (err) => {
        console.error(`Peer error (${remoteSocketId}):`, err);
      });

      peer.on('close', () => {
        peersRef.current.delete(remoteSocketId);
        const audio = audioElementsRef.current.get(remoteSocketId);
        if (audio) {
          audio.pause();
          audio.srcObject = null;
          audioElementsRef.current.delete(remoteSocketId);
        }
      });

      peersRef.current.set(remoteSocketId, peer);
      return peer;
    }

    function destroyPeer(socketId) {
      const peer = peersRef.current.get(socketId);
      if (peer) {
        peer.destroy();
        peersRef.current.delete(socketId);
      }
      const audio = audioElementsRef.current.get(socketId);
      if (audio) {
        audio.pause();
        audio.srcObject = null;
        audioElementsRef.current.delete(socketId);
      }
    }

    // Socket event handlers — set up BEFORE joining
    function handleUserJoined({ socketId }) {
      createPeer(socketId, true);
    }

    function handleUserLeft({ socketId }) {
      destroyPeer(socketId);
      setSpeakingPeers((prev) => {
        const next = new Set(prev);
        next.delete(socketId);
        return next;
      });
    }

    function handleOffer({ from, signal }) {
      let peer = peersRef.current.get(from);
      if (!peer) {
        peer = createPeer(from, false);
      }
      peer.signal(signal);
    }

    function handleAnswer({ from, signal }) {
      const peer = peersRef.current.get(from);
      if (peer) peer.signal(signal);
    }

    function handleIceCandidate({ from, signal }) {
      const peer = peersRef.current.get(from);
      if (peer) peer.signal(signal);
    }

    function handleSpeaking({ socketId, speaking }) {
      setSpeakingPeers((prev) => {
        const next = new Set(prev);
        if (speaking) next.add(socketId);
        else next.delete(socketId);
        return next;
      });
    }

    // Register listeners first so we don't miss anything
    socket.on('voice:user-joined', handleUserJoined);
    socket.on('voice:user-left', handleUserLeft);
    socket.on('webrtc:offer', handleOffer);
    socket.on('webrtc:answer', handleAnswer);
    socket.on('webrtc:ice-candidate', handleIceCandidate);
    socket.on('voice:speaking', handleSpeaking);

    async function init() {
      // Step 1: Acquire mic
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          console.error(
            'getUserMedia not available — HTTPS is required for non-localhost connections'
          );
          // Join voice anyway so user appears in room (no mic)
          socket.emit('voice:join', { channelId });
          return;
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: false,
        });

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        localStreamRef.current = stream;

        // Step 2: Set up voice activity detection
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.5;

        const source = audioCtx.createMediaStreamSource(stream);
        source.connect(analyser);
        audioContextRef.current = audioCtx;

        const dataArray = new Uint8Array(analyser.frequencyBinCount);

        vadIntervalRef.current = setInterval(() => {
          analyser.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i];
          }
          const average = sum / dataArray.length;
          const speaking = average > 15;

          // Update mic level (0-100 scale) for the visual meter
          setMicLevel(Math.min(100, Math.round((average / 60) * 100)));

          if (speaking !== wasSpeakingRef.current) {
            wasSpeakingRef.current = speaking;
            setIsSpeaking(speaking);
            socket.emit('voice:speaking', {
              channelId: channelIdRef.current,
              speaking,
            });
          }
        }, 100);
      } catch (err) {
        console.error('Failed to get microphone:', err);
      }

      if (cancelled) return;

      // Step 3: NOW join the voice channel on the server
      // This ensures our stream is ready before peers try to connect.
      // We do NOT initiate connections here — existing members will
      // receive voice:user-joined and initiate toward us. We just
      // wait for their offers in handleOffer.
      socket.emit('voice:join', { channelId });
    }

    init();

    return () => {
      cancelled = true;

      socket.off('voice:user-joined', handleUserJoined);
      socket.off('voice:user-left', handleUserLeft);
      socket.off('webrtc:offer', handleOffer);
      socket.off('webrtc:answer', handleAnswer);
      socket.off('webrtc:ice-candidate', handleIceCandidate);
      socket.off('voice:speaking', handleSpeaking);

      // Leave voice room
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
      for (const [, peer] of peersRef.current) {
        peer.destroy();
      }
      peersRef.current.clear();
      for (const [, audio] of audioElementsRef.current) {
        audio.pause();
        audio.srcObject = null;
      }
      audioElementsRef.current.clear();
      wasSpeakingRef.current = false;
      setSpeakingPeers(new Set());
    };
  }, [channelId, socket]);

  const toggleMute = useCallback(() => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
      }
    }
  }, []);

  const toggleTest = useCallback(() => {
    if (!audioContextRef.current || !localStreamRef.current) return;

    if (loopbackRef.current) {
      // Stop loopback
      loopbackRef.current.disconnect();
      loopbackRef.current = null;
      setTesting(false);
    } else {
      // Route mic → speakers so user hears themselves
      const source = audioContextRef.current.createMediaStreamSource(localStreamRef.current);
      // Add a small delay so it doesn't feel like just bone conduction
      const delay = audioContextRef.current.createDelay();
      delay.delayTime.value = 0.1;
      source.connect(delay);
      delay.connect(audioContextRef.current.destination);
      loopbackRef.current = source;
      setTesting(true);
    }
  }, []);

  return { isMuted, isSpeaking, micLevel, testing, toggleMute, toggleTest, speakingPeers };
}
