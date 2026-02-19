import JukeboxCard from './JukeboxCard.jsx';

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
  dmChannels,
  activeDM,
  onDMSelect,
}) {
  const textChannels = channels.filter((c) => c.type === 'text');
  const voiceChannels = channels.filter((c) => c.type === 'voice');

  const {
    isMuted, isSpeaking, speakingPeers, toggleMute,
    isSharing, sharingUser, startSharing, stopSharing, sharingSupported, musicVolume, setMusicVolume,
    shareVolume, setShareVolume, musicAnalyserRef,
    isScreenSharing, screenSharer, startScreenShare, stopScreenShare, screenShareSupported,
  } = voiceState || {};

  return (
    <div className={`bg-discord-darker flex flex-col h-full flex-shrink-0 pb-14 sm:pb-0 ambient-bg${voiceChannel ? ' ambient-bg-voice' : ''}`}>
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
                      const memberSharing = sharingUser?.username === member.username;
                      const memberSpeaking = isJoined
                        ? isSelf
                          ? isSpeaking
                          : speakingPeers?.has(member.socketId) || member.speaking
                        : false;
                      return (
                        <div
                          key={member.socketId}
                          className="flex items-center gap-2.5 py-1 px-1.5 rounded hover:bg-discord-hover/40 transition-colors voice-member-enter"
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
                          {memberSharing && (
                            <svg className="w-3.5 h-3.5 text-discord-green flex-shrink-0 ml-auto" viewBox="0 0 24 24" fill="currentColor" title="Sharing audio">
                              <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                            </svg>
                          )}
                          {member.screenSharing && (
                            <svg className={`w-3.5 h-3.5 text-discord-green flex-shrink-0 ${memberSharing ? '' : 'ml-auto'}`} viewBox="0 0 24 24" fill="currentColor" title="Sharing screen">
                              <path d="M21 3H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h5v2h8v-2h5c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 14H3V5h18v12z" />
                            </svg>
                          )}
                          {((isSelf && isMuted) || member.muted) && (
                            <svg className={`w-3.5 h-3.5 text-discord-red flex-shrink-0 ${(memberSharing || member.screenSharing) ? '' : 'ml-auto'}`} viewBox="0 0 24 24" fill="currentColor">
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

        {/* Direct Messages */}
        {dmChannels && dmChannels.length > 0 && (
          <>
            <div className="px-1.5 mb-1 mt-4">
              <span className="text-[11px] font-bold text-discord-muted uppercase tracking-wide">
                Direct Messages
              </span>
            </div>
            <div className="space-y-px mb-4">
              {dmChannels.map((dm) => (
                <button
                  key={dm.id}
                  onClick={() => onDMSelect?.(dm.id)}
                  className={`w-full text-left px-2 py-1.5 rounded flex items-center gap-2 transition-colors group ${
                    activeDM === dm.id
                      ? 'bg-discord-active text-white'
                      : 'text-discord-muted hover:bg-discord-hover hover:text-discord-text'
                  }`}
                >
                  <div
                    className="w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center text-white text-[10px] font-bold"
                    style={{ backgroundColor: dm.avatarColor }}
                  >
                    {dm.username[0].toUpperCase()}
                  </div>
                  <span className="text-[15px] font-medium truncate">{dm.username}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Voice connection panel — shown when in a voice channel */}
      {voiceChannel && (
        <div className="px-2 py-1.5 bg-discord-dark/60 border-t border-black/30 popover-enter">
          {/* Jukebox card — shown when someone is sharing audio */}
          {sharingUser && <JukeboxCard
            sharingUser={sharingUser}
            isSharing={isSharing}
            musicVolume={musicVolume}
            setMusicVolume={setMusicVolume}
            shareVolume={shareVolume}
            setShareVolume={setShareVolume}
            musicAnalyserRef={musicAnalyserRef}
          />}
          <div className="flex items-center gap-1.5 px-1.5 mb-2 mt-1">
            <svg className="w-3.5 h-3.5 text-discord-green flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 3a1 1 0 0 0-1.707-.707L5.586 7H4a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h1.586l4.707 4.707A1 1 0 0 0 12 21V3z" />
            </svg>
            <span className="text-[11px] font-semibold text-discord-green truncate">
              Voice Connected / {voiceChannelName || 'Voice Chat'}
            </span>
          </div>
          <div className="flex items-center gap-1.5 px-1">
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
            {screenShareSupported && (
              <button
                onClick={isScreenSharing ? stopScreenShare : startScreenShare}
                disabled={!!(screenSharer && !isScreenSharing)}
                className={`flex-1 flex items-center justify-center p-1.5 rounded transition-colors ${
                  isScreenSharing
                    ? 'bg-discord-green/20 text-discord-green hover:bg-discord-green/30'
                    : screenSharer
                      ? 'text-discord-muted/40 cursor-not-allowed'
                      : 'text-discord-muted hover:bg-discord-hover hover:text-discord-text'
                }`}
                title={isScreenSharing ? 'Stop sharing screen' : screenSharer ? `${screenSharer.username} is sharing screen` : 'Share screen'}
              >
                <svg className="w-4.5 h-4.5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M21 3H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h5v2h8v-2h5c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 14H3V5h18v12z" />
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

    </div>
  );
}
