import { useRef, useEffect } from 'react';

// ── Constants ────────────────────────────────────────────────────
const BAR_COUNT = 32;
const PARTICLE_COUNT = 18;
const HUE_CYCLE_DURATION = 45000; // 45s full rotation
const BASS_BINS = 6; // first 6 FFT bins for bass energy
const BASS_SMOOTH = 0.85; // exponential smoothing for bass
const FFT_BINS = 64; // fftSize=128 → 64 frequency bins

// Precompute logarithmic bin ranges for each bar.
// Maps 32 bars to 64 FFT bins on a log scale so bass/mids get more bars
// and the sparse high-frequency bins are compressed into fewer bars.
const BAR_BIN_RANGES = (() => {
  const ranges = [];
  const minFreq = 1;   // skip DC bin 0
  const maxFreq = FFT_BINS;
  const logMin = Math.log(minFreq);
  const logMax = Math.log(maxFreq);
  for (let i = 0; i < BAR_COUNT; i++) {
    const startBin = Math.round(Math.exp(logMin + (logMax - logMin) * (i / BAR_COUNT)));
    const endBin = Math.round(Math.exp(logMin + (logMax - logMin) * ((i + 1) / BAR_COUNT)));
    // Ensure at least 1 bin per bar and no overlap
    ranges.push([
      Math.min(startBin, FFT_BINS - 1),
      Math.max(endBin, startBin + 1),
    ]);
  }
  return ranges;
})();

// 3 nebula blob centers (normalized 0-1) with 120-degree hue offsets
const NEBULA_CENTERS = [
  { cx: 0.3, cy: 0.35, hueOffset: 0 },
  { cx: 0.7, cy: 0.3, hueOffset: 120 },
  { cx: 0.5, cy: 0.7, hueOffset: 240 },
];

function createParticles(count) {
  const particles = [];
  for (let i = 0; i < count; i++) {
    particles.push({
      x: Math.random(),           // normalized 0-1
      y: Math.random(),           // normalized 0-1
      baseSize: 1.5 + Math.random() * 2.5,
      speed: 0.002 + Math.random() * 0.004,
      wobblePhase: Math.random() * Math.PI * 2,
      wobbleSpeed: 0.5 + Math.random() * 1.5,
      freqBin: Math.floor(Math.random() * BAR_COUNT),
      alpha: 0.3 + Math.random() * 0.4,
    });
  }
  return particles;
}

function drawNebula(ctx, w, h, baseHue, bassEnergy, time) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const blob of NEBULA_CENTERS) {
    const hue = (baseHue + blob.hueOffset) % 360;
    // Slow positional drift via sine-wave orbiting
    const drift = 0.06;
    const cx = (blob.cx + Math.sin(time * 0.0003 + blob.hueOffset) * drift) * w;
    const cy = (blob.cy + Math.cos(time * 0.00025 + blob.hueOffset * 0.5) * drift) * h;
    // Radius pulses with bass energy
    const baseRadius = Math.max(w, h) * 0.45;
    const radius = baseRadius * (0.7 + bassEnergy * 0.5);
    const alpha = 0.08 + bassEnergy * 0.12;

    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    grad.addColorStop(0, `hsla(${hue}, 80%, 55%, ${alpha})`);
    grad.addColorStop(0.4, `hsla(${hue}, 70%, 40%, ${alpha * 0.5})`);
    grad.addColorStop(1, `hsla(${hue}, 60%, 30%, 0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.restore();
}

function drawBars(ctx, w, h, bars, baseHue) {
  const padding = 10; // fixed px inset from card edges
  const gap = 2;     // fixed px gap between bars
  const barW = (w - padding * 2 - gap * (BAR_COUNT - 1)) / BAR_COUNT;
  const maxH = h * 0.65;
  const baseY = h * 0.75;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < BAR_COUNT; i++) {
    const val = bars[i];
    const barH = val * maxH;
    if (barH < 0.5) continue;

    const x = padding + i * (barW + gap);
    const hue = (baseHue + (i / BAR_COUNT) * 180) % 360;
    const alpha = 0.4 + val * 0.6;

    // Main bar with rounded top
    ctx.fillStyle = `hsla(${hue}, 85%, 60%, ${alpha})`;
    ctx.beginPath();
    const radius = Math.min(barW / 2, barH / 2, 3);
    ctx.moveTo(x, baseY);
    ctx.lineTo(x, baseY - barH + radius);
    ctx.quadraticCurveTo(x, baseY - barH, x + radius, baseY - barH);
    ctx.lineTo(x + barW - radius, baseY - barH);
    ctx.quadraticCurveTo(x + barW, baseY - barH, x + barW, baseY - barH + radius);
    ctx.lineTo(x + barW, baseY);
    ctx.fill();

    // Bloom glow on loud bars
    if (val > 0.25) {
      ctx.shadowColor = `hsla(${hue}, 90%, 65%, ${val * 0.6})`;
      ctx.shadowBlur = 6;
      ctx.fillRect(x, baseY - barH, barW, barH);
      ctx.shadowBlur = 0;
      ctx.shadowColor = 'transparent';
    }

    // Mirror reflection below baseline
    const mirrorMax = Math.min(barH * 0.4, h * 0.15);
    if (mirrorMax > 0.5) {
      const grad = ctx.createLinearGradient(0, baseY + 1, 0, baseY + 1 + mirrorMax);
      grad.addColorStop(0, `hsla(${hue}, 80%, 55%, ${alpha * 0.25})`);
      grad.addColorStop(1, `hsla(${hue}, 80%, 55%, 0)`);
      ctx.fillStyle = grad;
      ctx.fillRect(x, baseY + 1, barW, mirrorMax);
    }
  }
  ctx.restore();
}

function updateAndDrawParticles(ctx, w, h, particles, bars, baseHue, dt) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const p of particles) {
    // Move upward
    p.y -= p.speed * (dt / 16);
    // Horizontal wobble
    p.wobblePhase += p.wobbleSpeed * (dt / 1000);
    const wobbleX = Math.sin(p.wobblePhase) * 0.02;
    p.x += wobbleX;

    // Wrap around
    if (p.y < -0.05) { p.y = 1.05; p.x = Math.random(); }
    if (p.x < -0.05) p.x = 1.05;
    if (p.x > 1.05) p.x = -0.05;

    // Scale/brightness from linked frequency bar
    const energy = bars[p.freqBin] || 0;
    const size = p.baseSize * (1 + energy * 2.5);
    const alpha = p.alpha * (0.3 + energy * 0.7);

    const px = p.x * w;
    const py = p.y * h;
    const hue = (baseHue + (p.freqBin / BAR_COUNT) * 180) % 360;

    const grad = ctx.createRadialGradient(px, py, 0, px, py, size);
    grad.addColorStop(0, `hsla(${hue}, 80%, 70%, ${alpha})`);
    grad.addColorStop(1, `hsla(${hue}, 80%, 50%, 0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(px - size, py - size, size * 2, size * 2);
  }
  ctx.restore();
}

// ── Component ────────────────────────────────────────────────────
export default function JukeboxCard({ sharingUser, isSharing, musicVolume, setMusicVolume, shareVolume, setShareVolume, musicAnalyserRef }) {
  const containerRef = useRef(null);
  const titleRef = useRef(null);
  const canvasRef = useRef(null);
  const cardRef = useRef(null);
  const animFrameRef = useRef(null);
  const barsRef = useRef(new Float32Array(BAR_COUNT));
  const dataRef = useRef(new Uint8Array(64));
  const ctxRef = useRef(null);
  const dimsRef = useRef({ w: 230, h: 148 });
  const particlesRef = useRef(createParticles(PARTICLE_COUNT));
  const bassSmoothedRef = useRef(0);

  const title = sharingUser.title || 'Sharing Audio';

  // Marquee for overflowing titles
  useEffect(() => {
    const el = titleRef.current;
    const container = containerRef.current;
    if (!el || !container) return;
    const diff = el.scrollWidth - container.clientWidth;
    if (diff > 2) {
      el.classList.add('jukebox-title-scroll');
      el.style.setProperty('--overflow', `${-diff}px`);
    } else {
      el.classList.remove('jukebox-title-scroll');
      el.style.removeProperty('--overflow');
    }
  });

  // Canvas ResizeObserver + rAF visualizer loop
  useEffect(() => {
    const canvas = canvasRef.current;
    const card = cardRef.current;
    if (!canvas || !card) return;

    const dpr = window.devicePixelRatio || 1;

    // Size canvas to match card
    function syncSize() {
      const rect = card.getBoundingClientRect();
      const w = Math.round(rect.width);
      const h = Math.round(rect.height);
      if (w === dimsRef.current.w && h === dimsRef.current.h) return;
      dimsRef.current = { w, h };
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);
      ctxRef.current = ctx;
    }
    syncSize();

    const ro = new ResizeObserver(syncSize);
    ro.observe(card);

    const bars = barsRef.current;
    const data = dataRef.current;
    const particles = particlesRef.current;
    let frameCount = 0;
    let running = true;
    let lastTime = performance.now();

    function draw(now) {
      if (!running) return;
      animFrameRef.current = requestAnimationFrame(draw);

      const dt = Math.min(now - lastTime, 50); // cap delta at 50ms
      lastTime = now;

      const ctx = ctxRef.current;
      if (!ctx) return;
      const { w, h } = dimsRef.current;

      const analyser = musicAnalyserRef?.current;

      // Read frequency data
      if (analyser) {
        try { analyser.getByteFrequencyData(data); } catch { /* closed ctx */ }
      }

      // Update bars: log-scale FFT bin mapping
      let energySum = 0;
      let bassSum = 0;
      for (let i = 0; i < BAR_COUNT; i++) {
        const [startBin, endBin] = BAR_BIN_RANGES[i];
        let sum = 0;
        let count = 0;
        for (let b = startBin; b < endBin && b < FFT_BINS; b++) {
          sum += (data[b] || 0);
          count++;
        }
        const raw = count > 0 ? (sum / count) / 255 : 0;
        if (raw > bars[i]) {
          bars[i] = raw; // instant attack
        } else {
          bars[i] *= 0.92; // exponential decay
        }
        energySum += bars[i];
        if (i < BASS_BINS) bassSum += bars[i];
      }
      const avgEnergy = energySum / BAR_COUNT;
      const bassRaw = bassSum / BASS_BINS;
      bassSmoothedRef.current = bassSmoothedRef.current * BASS_SMOOTH + bassRaw * (1 - BASS_SMOOTH);
      const bassEnergy = bassSmoothedRef.current;

      // Global hue cycle
      const baseHue = (now % HUE_CYCLE_DURATION) / HUE_CYCLE_DURATION * 360;

      // ── Draw layers ──
      ctx.clearRect(0, 0, w, h);

      // Layer 1: Nebula
      drawNebula(ctx, w, h, baseHue, bassEnergy, now);

      // Layer 2: Frequency bars
      drawBars(ctx, w, h, bars, baseHue);

      // Layer 3: Particles
      updateAndDrawParticles(ctx, w, h, particles, bars, baseHue, dt);

      // Card glow — update DOM every 6 frames (~100ms)
      if (++frameCount % 6 === 0 && cardRef.current) {
        if (avgEnergy > 0.01) {
          const hue = baseHue;
          const glowAlpha = Math.min(0.5, avgEnergy * 0.6);
          const glowSpread = Math.round(4 + avgEnergy * 8);
          cardRef.current.style.boxShadow = `0 0 ${glowSpread}px hsla(${hue}, 80%, 55%, ${glowAlpha})`;
          cardRef.current.style.borderColor = `hsla(${hue}, 80%, 55%, ${0.2 + avgEnergy * 0.3})`;
        } else {
          cardRef.current.style.boxShadow = '';
          cardRef.current.style.borderColor = '';
        }
      }
    }

    animFrameRef.current = requestAnimationFrame(draw);

    return () => {
      running = false;
      ro.disconnect();
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (card) {
        card.style.boxShadow = '';
        card.style.borderColor = '';
      }
    };
  }, [musicAnalyserRef]);

  return (
    <div
      ref={cardRef}
      className="mx-0.5 mb-1 rounded-lg border border-white/10 overflow-hidden relative"
      style={{ transition: 'box-shadow 150ms ease-out, border-color 150ms ease-out' }}
    >
      {/* Layer 0: Full-card canvas background */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        style={{ zIndex: 0 }}
      />

      {/* Layer 1: Dark gradient scrim for readability */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          zIndex: 1,
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.25) 35%, rgba(0,0,0,0.10) 55%, rgba(0,0,0,0.65) 100%)',
        }}
      />

      {/* Layer 2: Foreground content */}
      <div className="relative" style={{ zIndex: 2 }}>
        {/* Header + shared by */}
        <div className="flex items-center gap-1.5 px-2.5 pt-1.5 pb-0.5 mx-1 mt-0.5 rounded bg-black/30">
          <svg className="w-3 h-3 text-white/90 flex-shrink-0 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
          </svg>
          <span className="text-[10px] font-bold text-white/90 uppercase tracking-wider drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">Now Playing</span>
          <span className="ml-auto text-[10px] text-white/70 truncate drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
            {isSharing ? 'You' : sharingUser.username}
          </span>
        </div>

        {/* Visualization breathing space */}
        <div className="h-16" />

        {/* Scrolling title */}
        <div ref={containerRef} className="px-2.5 overflow-hidden jukebox-title-mask">
          <div
            ref={titleRef}
            className="text-[13px] text-white font-medium whitespace-nowrap drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]"
          >
            {title}
          </div>
        </div>

        {/* Volume slider */}
        <div className="flex items-center gap-1.5 px-2.5 pt-1 pb-1.5 mx-1 mb-0.5 rounded bg-black/30">
          <svg className="w-3 h-3 text-white/60 flex-shrink-0 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]" viewBox="0 0 24 24" fill="currentColor">
            <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 8.5v7a4.47 4.47 0 0 0 2.5-3.5z" />
          </svg>
          <input
            type="range"
            min="0"
            max="100"
            value={isSharing ? (shareVolume ?? 100) : (musicVolume ?? 80)}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (isSharing) setShareVolume?.(v);
              else setMusicVolume?.(v);
            }}
            className="voice-slider flex-1"
          />
          <span className="text-[10px] text-white/60 tabular-nums w-7 text-right drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
            {isSharing ? (shareVolume ?? 100) : (musicVolume ?? 80)}%
          </span>
        </div>
      </div>
    </div>
  );
}
