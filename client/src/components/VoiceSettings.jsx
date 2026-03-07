export default function VoiceSettings({ voiceState, voiceChannel, sounds }) {
  const {
    isSpeaking, micLevel, sensitivity, setSensitivity,
    sensitivityMode, setSensitivityMode, noiseSuppression, setNoiseSuppression,
  } = voiceState || {};

  return (
    <>
      <div className="mb-1">
        <div className="flex items-center justify-between mb-1.5">
          <div>
            <div className="text-[12px] text-discord-text">Input Sensitivity</div>
            <div className="text-[10px] text-discord-muted/60 mt-0.5">
              {(sensitivityMode ?? 'auto') === 'auto' ? 'Automatically determined' : 'Manual threshold'}
            </div>
          </div>
          <button
            onClick={() => setSensitivityMode?.((sensitivityMode ?? 'auto') === 'auto' ? 'manual' : 'auto')}
            className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${
              (sensitivityMode ?? 'auto') === 'auto' ? 'bg-discord-green' : 'bg-discord-muted/30'
            }`}
          >
            <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
              (sensitivityMode ?? 'auto') === 'auto' ? 'translate-x-4' : 'translate-x-0.5'
            }`} />
          </button>
        </div>
        {(sensitivityMode ?? 'auto') === 'manual' && (
          <div className="mt-2">
            <div className="flex items-center justify-between mb-1">
              <label className="text-[11px] text-discord-muted">Threshold</label>
              <span className="text-[11px] text-discord-muted tabular-nums">{sensitivity ?? 50}%</span>
            </div>
            <input type="range" min="0" max="100" value={sensitivity ?? 50}
              onChange={(e) => setSensitivity?.(Number(e.target.value))}
              className="voice-slider w-full" />
          </div>
        )}
      </div>
      <div className="mt-3 pt-3 border-t border-white/5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[12px] text-discord-text">Noise Suppression</div>
            <div className="text-[10px] text-discord-muted/60 mt-0.5">AI-powered background noise removal</div>
          </div>
          <button
            onClick={() => setNoiseSuppression?.(!noiseSuppression)}
            className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${
              noiseSuppression ? 'bg-discord-green' : 'bg-discord-muted/30'
            }`}
          >
            <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
              noiseSuppression ? 'translate-x-4' : 'translate-x-0.5'
            }`} />
          </button>
        </div>
      </div>
      {sounds && (
        <div className="mt-3 pt-3 border-t border-white/5">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[12px] text-discord-text">Sound Effects</div>
              <div className="text-[10px] text-discord-muted/60 mt-0.5">UI feedback sounds</div>
            </div>
            <button
              onClick={() => sounds.setEnabled(!sounds.enabled)}
              className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${
                sounds.enabled ? 'bg-discord-green' : 'bg-discord-muted/30'
              }`}
            >
              <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                sounds.enabled ? 'translate-x-4' : 'translate-x-0.5'
              }`} />
            </button>
          </div>
          {sounds.enabled && (
            <div className="mt-2">
              <div className="flex items-center justify-between mb-1">
                <label className="text-[11px] text-discord-muted">Volume</label>
                <span className="text-[11px] text-discord-muted tabular-nums">{sounds.volume}%</span>
              </div>
              <input type="range" min="0" max="100" value={sounds.volume}
                onChange={(e) => sounds.setVolume(Number(e.target.value))}
                className="voice-slider w-full" />
            </div>
          )}
        </div>
      )}
      {voiceChannel && (
        <div className="mt-2.5">
          <div className="text-[11px] text-discord-muted mb-1">Mic Level</div>
          <div className="h-2 bg-discord-darker rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-75 ${
                isSpeaking ? 'bg-discord-green' : 'bg-discord-muted/40'
              }`}
              style={{ width: `${micLevel || 0}%` }}
            />
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-[10px] text-discord-muted/60">Quiet</span>
            <span className={`text-[10px] ${isSpeaking ? 'text-discord-green' : 'text-discord-muted/60'}`}>
              {isSpeaking ? 'Transmitting' : 'Gate closed'}
            </span>
          </div>
        </div>
      )}
    </>
  );
}
