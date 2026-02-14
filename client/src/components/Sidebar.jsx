import { useState, useRef, useEffect } from 'react';

const STATUS_CONFIG = {
  online: { label: 'Online', color: 'bg-discord-green', textColor: 'text-discord-green' },
  away: { label: 'Away', color: 'bg-discord-yellow', textColor: 'text-discord-yellow' },
  busy: { label: 'Do Not Disturb', color: 'bg-discord-red', textColor: 'text-discord-red' },
  invisible: { label: 'Invisible', color: 'bg-discord-muted/60', textColor: 'text-discord-muted' },
};

function StatusDot({ status, className = '' }) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.online;
  if (status === 'busy') {
    return (
      <div className={`${config.color} rounded-full flex items-center justify-center ${className}`}>
        <div className="w-1.5 h-0.5 bg-discord-dark rounded-full" />
      </div>
    );
  }
  if (status === 'away') {
    return (
      <div className={`${config.color} rounded-full relative ${className}`}>
        <div className="absolute top-0.5 left-0.5 w-1.5 h-1.5 bg-discord-dark rounded-full" />
      </div>
    );
  }
  return <div className={`${config.color} rounded-full ${className}`} />;
}

export default function Sidebar({
  channels,
  activeChannel,
  voiceChannel,
  voiceMembers,
  onChannelSelect,
  onVoiceJoin,
  onVoiceLeave,
  user,
  voiceState,
  voiceChannelName,
  onLogout,
  userStatus,
  onStatusChange,
}) {
  const textChannels = channels.filter((c) => c.type === 'text');
  const voiceChannels = channels.filter((c) => c.type === 'voice');

  const {
    isMuted, isSpeaking, speakingPeers, toggleMute, micLevel, sensitivity, setSensitivity,
    isSharing, sharingUser, startSharing, stopSharing, sharingSupported, musicVolume, setMusicVolume,
    shareVolume, setShareVolume,
  } = voiceState || {};

  const [showSettings, setShowSettings] = useState(false);
  const [showStatusPicker, setShowStatusPicker] = useState(false);
  const settingsRef = useRef(null);
  const statusRef = useRef(null);

  // Close settings popover on click outside
  useEffect(() => {
    if (!showSettings && !showStatusPicker) return;
    function handleClick(e) {
      if (showSettings && settingsRef.current && !settingsRef.current.contains(e.target)) {
        setShowSettings(false);
      }
      if (showStatusPicker && statusRef.current && !statusRef.current.contains(e.target)) {
        setShowStatusPicker(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showSettings, showStatusPicker]);

  const statusConfig = STATUS_CONFIG[userStatus] || STATUS_CONFIG.online;

  return (
    <div className="w-60 bg-discord-darker flex flex-col h-full flex-shrink-0">
      {/* Server header */}
      <div className="h-12 px-4 flex items-center border-b border-black/40 hover:bg-discord-hover transition-colors cursor-pointer">
        <h2 className="font-bold text-white truncate tracking-tight">Disclone</h2>
      </div>

      {/* Channel list */}
      <div className="flex-1 overflow-y-auto pt-3 px-2">
        {/* Text channels */}
        <div className="px-1.5 mb-1 mt-2">
          <span className="text-[11px] font-bold text-discord-muted uppercase tracking-wide">
            Text Channels
          </span>
        </div>
        <div className="space-y-px mb-4">
          {textChannels.map((channel) => (
            <button
              key={channel.id}
              onClick={() => onChannelSelect(channel.id)}
              className={`w-full text-left px-2 py-1.5 rounded flex items-center gap-2 transition-colors group ${
                activeChannel === channel.id
                  ? 'bg-discord-active text-white'
                  : 'text-discord-muted hover:bg-discord-hover hover:text-discord-text'
              }`}
            >
              <span className={`text-lg leading-none font-light ${activeChannel === channel.id ? 'text-white/70' : 'text-discord-muted/50'}`}>#</span>
              <span className="text-[15px] font-medium">{channel.name}</span>
            </button>
          ))}
        </div>

        {/* Voice channels */}
        <div className="px-1.5 mb-1">
          <span className="text-[11px] font-bold text-discord-muted uppercase tracking-wide">
            Voice Channels
          </span>
        </div>
        <div className="space-y-px">
          {voiceChannels.map((channel) => {
            const members = voiceMembers.get(channel.id) || [];
            const isJoined = voiceChannel === channel.id;
            return (
              <div key={channel.id}>
                <button
                  onClick={() =>
                    isJoined ? onVoiceLeave() : onVoiceJoin(channel.id)
                  }
                  className={`w-full text-left px-2 py-1.5 rounded flex items-center gap-2 transition-colors group ${
                    isJoined
                      ? 'bg-discord-active text-white'
                      : 'text-discord-muted hover:bg-discord-hover hover:text-discord-text'
                  }`}
                >
                  <svg
                    className={`w-5 h-5 flex-shrink-0 ${isJoined ? 'text-discord-green' : 'text-discord-muted/50 group-hover:text-discord-muted'}`}
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <path d="M12 3a1 1 0 0 0-1.707-.707L5.586 7H4a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h1.586l4.707 4.707A1 1 0 0 0 12 21V3z" />
                  </svg>
                  <span className="text-[15px] font-medium">{channel.name}</span>
                  {members.length > 0 && (
                    <span className="ml-auto text-[11px] text-discord-muted bg-discord-dark/40 px-1.5 py-0.5 rounded-full font-medium">
                      {members.length}
                    </span>
                  )}
                </button>
                {members.length > 0 && (
                  <div className="ml-3 pl-3 py-1 space-y-px border-l-2 border-discord-border/30">
                    {members.map((member) => {
                      const isSelf = member.username === user.username;
                      const memberSpeaking = isJoined
                        ? isSelf
                          ? isSpeaking
                          : speakingPeers?.has(member.socketId) || member.speaking
                        : false;
                      return (
                        <div
                          key={member.socketId}
                          className="flex items-center gap-2.5 py-1 px-1.5 rounded hover:bg-discord-hover/40 transition-colors"
                        >
                          <div
                            className={`w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center text-white text-[10px] font-bold transition-shadow duration-200 ${
                              memberSpeaking ? 'speaking-glow' : ''
                            }`}
                            style={{ backgroundColor: member.avatarColor }}
                          >
                            {member.username[0].toUpperCase()}
                          </div>
                          <span className={`text-[13px] truncate ${isSelf ? 'text-white font-medium' : 'text-discord-muted'}`}>
                            {member.username}
                          </span>
                          {((isSelf && isMuted) || member.muted) && (
                            <svg className="w-3.5 h-3.5 text-discord-red flex-shrink-0 ml-auto" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z" />
                            </svg>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Voice connection panel — shown when in a voice channel */}
      {voiceChannel && (
        <div className="px-2 py-2 bg-discord-dark/60 border-t border-black/30">
          <div className="flex items-center gap-2 px-1.5 mb-2">
            <svg className="w-4 h-4 text-discord-green flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 3a1 1 0 0 0-1.707-.707L5.586 7H4a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h1.586l4.707 4.707A1 1 0 0 0 12 21V3z" />
            </svg>
            <div className="flex-1 min-w-0">
              <div className="text-[12px] font-semibold text-discord-green leading-tight">Voice Connected</div>
              <div className="text-[11px] text-discord-muted truncate leading-tight mt-0.5">{voiceChannelName || 'Voice Chat'}</div>
            </div>
          </div>
          {/* Music sharing indicator */}
          {sharingUser && !isSharing && (
            <div className="flex items-center gap-1.5 px-2 py-1 mb-1.5 mx-1 rounded bg-discord-green/10 text-discord-green">
              <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
              </svg>
              <span className="text-[11px] font-medium truncate">{sharingUser.username} is sharing audio</span>
            </div>
          )}
          {/* Presenter volume slider — shown when sharing */}
          {isSharing && (
            <div className="px-2 py-1 mb-1.5 mx-1 rounded bg-discord-green/10">
              <div className="flex items-center justify-between mb-1">
                <label className="text-[11px] text-discord-green font-medium">Share Volume</label>
                <span className="text-[10px] text-discord-green/70 tabular-nums">{shareVolume ?? 100}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={shareVolume ?? 100}
                onChange={(e) => setShareVolume?.(Number(e.target.value))}
                className="voice-slider w-full"
              />
            </div>
          )}
          <div className="flex items-center gap-1 px-1">
            <button
              onClick={toggleMute}
              className={`flex-1 flex items-center justify-center p-1.5 rounded transition-colors ${
                isMuted
                  ? 'bg-discord-red/20 text-discord-red hover:bg-discord-red/30'
                  : 'text-discord-muted hover:bg-discord-hover hover:text-discord-text'
              }`}
              title={isMuted ? 'Unmute' : 'Mute'}
            >
              <svg className="w-4.5 h-4.5" viewBox="0 0 24 24" fill="currentColor">
                {isMuted ? (
                  <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z" />
                ) : (
                  <path d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z" />
                )}
              </svg>
            </button>
            {sharingSupported && (
              <button
                onClick={isSharing ? stopSharing : startSharing}
                disabled={!!(sharingUser && !isSharing)}
                className={`flex-1 flex items-center justify-center p-1.5 rounded transition-colors ${
                  isSharing
                    ? 'bg-discord-green/20 text-discord-green hover:bg-discord-green/30'
                    : sharingUser
                      ? 'text-discord-muted/40 cursor-not-allowed'
                      : 'text-discord-muted hover:bg-discord-hover hover:text-discord-text'
                }`}
                title={isSharing ? 'Stop sharing audio' : sharingUser ? `${sharingUser.username} is sharing` : 'Share audio'}
              >
                <svg className="w-4.5 h-4.5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                </svg>
              </button>
            )}
            <button
              onClick={onVoiceLeave}
              className="flex-1 flex items-center justify-center p-1.5 rounded text-discord-muted hover:bg-discord-red/20 hover:text-discord-red transition-colors"
              title="Disconnect"
            >
              <svg className="w-4.5 h-4.5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.956.956 0 0 1-.29-.7c0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28a11.27 11.27 0 0 0-2.67-1.85.996.996 0 0 1-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* User bar */}
      <div className="relative px-2 py-2 bg-discord-dark/80 border-t border-black/40" ref={settingsRef}>
        {/* Settings popover */}
        {showSettings && (
          <div className="absolute bottom-full left-2 right-2 mb-2 bg-discord-dark rounded-lg shadow-2xl border border-white/10 p-3 z-50">
            <div className="text-[11px] font-bold text-discord-muted uppercase tracking-wide mb-3">
              Voice Settings
            </div>

            <div className="mb-1">
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[12px] text-discord-text">Input Sensitivity</label>
                <span className="text-[11px] text-discord-muted tabular-nums">{sensitivity ?? 50}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={sensitivity ?? 50}
                onChange={(e) => setSensitivity?.(Number(e.target.value))}
                className="voice-slider w-full"
              />
            </div>

            {/* Mic level indicator — only shown when in voice */}
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

            {/* Music volume slider — only shown when someone is sharing */}
            {sharingUser && (
              <div className="mt-3 pt-3 border-t border-white/5">
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[12px] text-discord-text">Music Volume</label>
                  <span className="text-[11px] text-discord-muted tabular-nums">{musicVolume ?? 80}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={musicVolume ?? 80}
                  onChange={(e) => setMusicVolume?.(Number(e.target.value))}
                  className="voice-slider w-full"
                />
                <div className="text-[10px] text-discord-muted/60 mt-1">
                  {sharingUser.username} is sharing audio
                </div>
              </div>
            )}
          </div>
        )}

        {/* Status picker dropdown */}
        {showStatusPicker && (
          <div ref={statusRef} className="absolute bottom-full left-2 mb-2 bg-discord-dark rounded-lg shadow-2xl border border-white/10 py-1.5 z-50 w-48">
            {Object.entries(STATUS_CONFIG).map(([key, config]) => (
              <button
                key={key}
                onClick={() => {
                  onStatusChange?.(key);
                  setShowStatusPicker(false);
                }}
                className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-left transition-colors hover:bg-discord-hover ${
                  userStatus === key ? 'text-white' : 'text-discord-text'
                }`}
              >
                <StatusDot status={key} className="w-3 h-3" />
                <span className="text-[13px] font-medium">{config.label}</span>
                {userStatus === key && (
                  <svg className="w-3.5 h-3.5 ml-auto text-discord-accent" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2.5 px-1.5 py-1 rounded hover:bg-discord-hover/50 transition-colors">
          <div
            className="relative flex-shrink-0 cursor-pointer"
            onClick={() => setShowStatusPicker((s) => !s)}
            title="Change status"
          >
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold"
              style={{ backgroundColor: user.avatarColor }}
            >
              {user.username[0].toUpperCase()}
            </div>
            <div className="absolute -bottom-0.5 -right-0.5 border-2 border-discord-dark rounded-full">
              <StatusDot status={userStatus || 'online'} className="w-3 h-3" />
            </div>
          </div>
          <div
            className="flex-1 min-w-0 cursor-pointer"
            onClick={() => setShowStatusPicker((s) => !s)}
            title="Change status"
          >
            <div className="text-[13px] font-semibold text-white truncate leading-tight">
              {user.username}
            </div>
            <div className={`text-[11px] ${statusConfig.textColor} leading-tight mt-0.5`}>
              {statusConfig.label}
            </div>
          </div>
          <button
            onClick={onLogout}
            className="p-1.5 rounded transition-colors flex-shrink-0 text-discord-muted hover:text-discord-red hover:bg-discord-red/10"
            title="Log Out"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M10.09 15.59L11.5 17l5-5-5-5-1.41 1.41L12.67 11H3v2h9.67l-2.58 2.59zM19 3H5c-1.11 0-2 .9-2 2v4h2V5h14v14H5v-4H3v4c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z" />
            </svg>
          </button>
          <button
            onClick={() => setShowSettings((s) => !s)}
            className={`p-1.5 rounded transition-colors flex-shrink-0 ${
              showSettings
                ? 'text-white bg-discord-active'
                : 'text-discord-muted hover:text-discord-text hover:bg-discord-hover'
            }`}
            title="Voice Settings"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

export { StatusDot };
