import { useState, useEffect, useRef } from 'react';
import VideoEffectsPanel from './VideoEffectsPanel.jsx';

function VideoTile({ stream, username, avatarColor, isSelf, isMuted }) {
  const videoRef = useRef(null);

  useEffect(() => {
    const el = videoRef.current;
    if (el && stream) {
      el.srcObject = stream;
    }
    return () => {
      if (el) {
        el.srcObject = null;
      }
    };
  }, [stream]);

  return (
    <div className="relative bg-discord-dark rounded-xl overflow-hidden aspect-video">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isSelf}
        className={`w-full h-full object-cover ${isSelf ? 'scale-x-[-1]' : ''}`}
      />
      <div className="absolute bottom-0 left-0 right-0 flex items-center gap-2 px-3 py-1.5 bg-gradient-to-t from-black/70 to-transparent">
        <div
          className="w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center text-white text-[9px] font-bold"
          style={{ backgroundColor: avatarColor }}
        >
          {username[0].toUpperCase()}
        </div>
        <span className="text-white text-xs font-medium truncate">
          {isSelf ? `${username} (You)` : username}
        </span>
        {isMuted && (
          <svg className="w-3.5 h-3.5 text-discord-red flex-shrink-0 ml-auto" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z" />
          </svg>
        )}
      </div>
    </div>
  );
}

export default function VideoGrid({ cameraStreams, localCameraStream, user, voiceMembers, isMuted, activeEffect, onSetVideoEffect }) {
  const [showEffects, setShowEffects] = useState(false);
  const [effectsAnchorRect, setEffectsAnchorRect] = useState(null);
  const effectsBtnRef = useRef(null);
  const totalTiles = (localCameraStream ? 1 : 0) + cameraStreams.size;
  if (totalTiles === 0) return null;

  const gridCols = totalTiles <= 1 ? 'grid-cols-1' : totalTiles <= 4 ? 'grid-cols-2' : 'grid-cols-3';
  const hasActiveEffect = activeEffect && activeEffect !== 'none';

  // Build member lookup from voiceMembers (flat array across all rooms)
  const memberLookup = new Map();
  if (voiceMembers) {
    for (const [, members] of voiceMembers) {
      for (const m of members) {
        memberLookup.set(m.socketId, m);
      }
    }
  }

  return (
    <div className="absolute inset-0 z-20 bg-discord-dark/95 flex flex-col popover-enter">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/10 flex-shrink-0">
        <svg className="w-5 h-5 text-discord-green" viewBox="0 0 24 24" fill="currentColor">
          <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" />
        </svg>
        <span className="text-white text-sm font-semibold">Video Call</span>
        <span className="text-discord-muted text-xs">
          {totalTiles} camera{totalTiles !== 1 ? 's' : ''}
        </span>
        {localCameraStream && onSetVideoEffect && (
          <button
            ref={effectsBtnRef}
            onClick={() => {
              setEffectsAnchorRect(effectsBtnRef.current?.getBoundingClientRect());
              setShowEffects((v) => !v);
            }}
            className={`ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
              hasActiveEffect
                ? 'bg-discord-brand/20 text-discord-brand hover:bg-discord-brand/30'
                : 'bg-white/5 text-discord-muted hover:bg-white/10 hover:text-white'
            }`}
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
            </svg>
            {hasActiveEffect ? 'Effects On' : 'Effects'}
          </button>
        )}
      </div>
      <div className={`flex-1 overflow-auto p-4 grid ${gridCols} gap-3 auto-rows-fr content-center`}>
        {localCameraStream && (
          <VideoTile
            stream={localCameraStream}
            username={user.username}
            avatarColor={user.avatarColor}
            isSelf
            isMuted={isMuted}
          />
        )}
        {[...cameraStreams.entries()].map(([peerId, stream]) => {
          const member = memberLookup.get(peerId);
          return (
            <VideoTile
              key={peerId}
              stream={stream}
              username={member?.username || 'Unknown'}
              avatarColor={member?.avatarColor || '#5865f2'}
              isSelf={false}
              isMuted={member?.muted || false}
            />
          );
        })}
      </div>
      {showEffects && (
        <VideoEffectsPanel
          activeEffect={activeEffect}
          onEffectChange={(key) => {
            onSetVideoEffect(key);
          }}
          onClose={() => setShowEffects(false)}
          anchorRect={effectsAnchorRect}
        />
      )}
    </div>
  );
}
