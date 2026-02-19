import { useState, useCallback, useRef, useEffect } from 'react';

// ── Sound definitions ───────────────────────────────────────────
// All sounds synthesized via Web Audio API — no audio files needed.

const SOUNDS = {
  voiceJoin: (ctx, vol) => {
    const now = ctx.currentTime + 0.02;
    const freqs = [523.25, 659.25]; // C5 → E5
    freqs.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const start = now + i * 0.14;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(vol * 0.18, start + 0.015);
      gain.gain.setValueAtTime(vol * 0.18, start + 0.1 - 0.02);
      gain.gain.linearRampToValueAtTime(0, start + 0.1);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.12);
    });
  },

  voiceLeave: (ctx, vol) => {
    const now = ctx.currentTime + 0.02;
    const freqs = [659.25, 523.25]; // E5 → C5
    freqs.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const start = now + i * 0.14;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(vol * 0.18, start + 0.015);
      gain.gain.setValueAtTime(vol * 0.18, start + 0.1 - 0.02);
      gain.gain.linearRampToValueAtTime(0, start + 0.1);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.12);
    });
  },

  userJoin: (ctx, vol) => {
    const now = ctx.currentTime + 0.02;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880; // A5
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(vol * 0.12, now + 0.008);
    gain.gain.linearRampToValueAtTime(0, now + 0.06);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.08);
  },

  userLeave: (ctx, vol) => {
    const now = ctx.currentTime + 0.02;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 659.25; // E5
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(vol * 0.12, now + 0.008);
    gain.gain.linearRampToValueAtTime(0, now + 0.08);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.1);
  },

  mute: (ctx, vol) => {
    const now = ctx.currentTime + 0.02;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 200;
    osc.detune.value = -100;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(vol * 0.1, now + 0.005);
    gain.gain.linearRampToValueAtTime(0, now + 0.04);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.06);
  },

  unmute: (ctx, vol) => {
    const now = ctx.currentTime + 0.02;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 400;
    osc.detune.value = 50;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(vol * 0.1, now + 0.005);
    gain.gain.linearRampToValueAtTime(0, now + 0.04);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.06);
  },

  messageSend: (ctx, vol) => {
    const now = ctx.currentTime + 0.02;
    [600, 800].forEach((freq) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(vol * 0.06, now + 0.005);
      gain.gain.linearRampToValueAtTime(0, now + 0.04);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.06);
    });
  },

  mention: (ctx, vol) => {
    const now = ctx.currentTime + 0.02;
    const freqs = [880, 1108.73]; // A5 → C#6 (major third)
    freqs.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const start = now + i * 0.12;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(vol * 0.15, start + 0.01);
      gain.gain.setValueAtTime(vol * 0.15, start + 0.08);
      gain.gain.linearRampToValueAtTime(0, start + 0.12);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.14);
    });
  },

  disconnect: (ctx, vol) => {
    const now = ctx.currentTime + 0.02;
    const freqs = [659.25, 523.25, 440]; // E5 → C5 → A4
    freqs.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const start = now + i * 0.1;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(vol * 0.15, start + 0.012);
      gain.gain.setValueAtTime(vol * 0.15, start + 0.07);
      gain.gain.linearRampToValueAtTime(0, start + 0.1);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.12);
    });
  },
};

export default function useSounds() {
  const ctxRef = useRef(null);

  const [enabled, setEnabledState] = useState(() => {
    const saved = localStorage.getItem('disclone_sound_enabled');
    return saved !== null ? saved === 'true' : true;
  });

  const [volume, setVolumeState] = useState(() => {
    const saved = localStorage.getItem('disclone_sound_volume');
    return saved !== null ? Number(saved) : 50;
  });

  const enabledRef = useRef(enabled);
  const volumeRef = useRef(volume);
  useEffect(() => { enabledRef.current = enabled; }, [enabled]);
  useEffect(() => { volumeRef.current = volume; }, [volume]);

  const setEnabled = useCallback((val) => {
    setEnabledState(val);
    localStorage.setItem('disclone_sound_enabled', String(val));
  }, []);

  const setVolume = useCallback((val) => {
    const v = Math.max(0, Math.min(100, Math.round(val)));
    setVolumeState(v);
    localStorage.setItem('disclone_sound_volume', String(v));
  }, []);

  const play = useCallback((name) => {
    if (!enabledRef.current) return;
    const fn = SOUNDS[name];
    if (!fn) return;

    let ctx = ctxRef.current;
    if (!ctx || ctx.state === 'closed') {
      try {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        ctxRef.current = ctx;
      } catch {
        return;
      }
    }

    if (ctx.state === 'suspended') {
      ctx.resume().then(() => fn(ctx, volumeRef.current / 100)).catch(() => {});
    } else {
      fn(ctx, volumeRef.current / 100);
    }
  }, []);

  return { play, volume, setVolume, enabled, setEnabled };
}
