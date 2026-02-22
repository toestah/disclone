import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { EFFECT_PRESETS } from '../lib/videoEffects.js';

const CATEGORIES = [
  { label: 'None', keys: ['none'] },
  { label: 'Filters', keys: ['grayscale', 'sepia', 'warm', 'cool'] },
  { label: 'Blur', keys: ['blur'] },
  { label: 'Virtual BG', keys: ['solid_dark', 'solid_white', 'gradient_ocean', 'gradient_sunset', 'gradient_forest'] },
];

function getSwatchStyle(key) {
  const preset = EFFECT_PRESETS[key];
  if (!preset) return {};
  if (key === 'none') return { background: '#4e5058' };
  if (preset.type === 'filter') {
    if (key === 'grayscale') return { background: 'linear-gradient(135deg, #666, #999)' };
    if (key === 'sepia') return { background: 'linear-gradient(135deg, #8b6914, #d4a94a)' };
    if (key === 'warm') return { background: 'linear-gradient(135deg, #e8a040, #f0c060)' };
    if (key === 'cool') return { background: 'linear-gradient(135deg, #4080c0, #60a0d8)' };
  }
  if (preset.type === 'blur') return { background: 'linear-gradient(135deg, #5865f2, #99aab5)', filter: 'blur(2px)' };
  if (preset.bg) return { background: preset.bg, border: key === 'solid_white' ? '1px solid #4e5058' : undefined };
  if (preset.gradient) {
    return { background: `linear-gradient(135deg, ${preset.gradient.join(', ')})` };
  }
  return {};
}

export default function VideoEffectsPanel({ activeEffect, onEffectChange, onClose, anchorRect }) {
  const panelRef = useRef(null);

  useEffect(() => {
    function handleKey(e) {
      if (e.key === 'Escape') onClose();
    }
    function handleClick(e) {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        onClose();
      }
    }
    document.addEventListener('keydown', handleKey);
    // Use setTimeout so the opening click doesn't immediately close
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClick);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('keydown', handleKey);
      document.removeEventListener('mousedown', handleClick);
    };
  }, [onClose]);

  const style = anchorRect ? {
    position: 'fixed',
    top: anchorRect.bottom + 8,
    right: Math.max(8, window.innerWidth - anchorRect.right),
    zIndex: 60,
  } : {
    position: 'fixed',
    top: 56,
    right: 8,
    zIndex: 60,
  };

  return createPortal(
    <div
      ref={panelRef}
      style={style}
      className="w-72 bg-discord-sidebar rounded-lg shadow-xl border border-white/10 popover-enter overflow-hidden"
    >
      <div className="px-3 py-2.5 border-b border-white/10">
        <h3 className="text-white text-sm font-semibold">Video Effects</h3>
      </div>
      <div className="p-2 max-h-80 overflow-y-auto">
        {CATEGORIES.map((cat) => (
          <div key={cat.label} className="mb-2 last:mb-0">
            <div className="text-discord-muted text-[11px] font-semibold uppercase tracking-wide px-1 mb-1">
              {cat.label}
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {cat.keys.map((key) => {
                const preset = EFFECT_PRESETS[key];
                const isActive = activeEffect === key;
                return (
                  <button
                    key={key}
                    onClick={() => onEffectChange(key)}
                    className={`flex flex-col items-center gap-1 p-1.5 rounded-md transition-colors ${
                      isActive
                        ? 'bg-discord-brand/20 ring-2 ring-discord-brand'
                        : 'hover:bg-white/5'
                    }`}
                  >
                    <div
                      className="w-full aspect-square rounded-md"
                      style={getSwatchStyle(key)}
                    />
                    <span className={`text-[10px] leading-tight truncate w-full text-center ${
                      isActive ? 'text-white font-medium' : 'text-discord-muted'
                    }`}>
                      {preset.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>,
    document.body
  );
}
