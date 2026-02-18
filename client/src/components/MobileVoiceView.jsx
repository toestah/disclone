import JukeboxCard from './JukeboxCard.jsx';

export default function MobileVoiceView({ voiceChannel, voiceChannelName, voiceMembers, voiceState, user, onVoiceLeave }) {
  const {
    isMuted, isSpeaking, speakingPeers, toggleMute,
    isSharing, sharingUser, startSharing, stopSharing, sharingSupported,
    musicVolume, setMusicVolume, shareVolume, setShareVolume, musicAnalyserRef,
  } = voiceState || {};

  const members = voiceMembers?.get(voiceChannel) || [];

  return (
    <div className="flex flex-col h-full bg-discord-chat pb-14">
      {/* Header */}
      <div className="h-12 px-4 flex items-center border-b border-black/30 flex-shrink-0 gap-2">
        <svg className="w-4 h-4 text-discord-green flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 3a1 1 0 0 0-1.707-.707L5.586 7H4a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h1.586l4.707 4.707A1 1 0 0 0 12 21V3z" />
        </svg>
        <span className="font-bold text-white text-[15px]">{voiceChannelName || 'Voice Chat'}</span>
        <span className="text-[11px] text-discord-green bg-discord-green/15 px-2 py-0.5 rounded-full font-medium">Connected</span>
      </div>

      {/* Member grid */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="grid grid-cols-3 gap-4 max-w-sm mx-auto">
          {members.map((member) => {
            const isSelf = member.username === user?.username;
            const memberSpeaking = isSelf
              ? isSpeaking
              : speakingPeers?.has(member.socketId) || member.speaking;
            return (
              <div key={member.socketId} className="flex flex-col items-center gap-1.5 voice-member-enter">
                <div className="relative">
                  <div
                    className={`w-14 h-14 rounded-full flex items-center justify-center text-white text-lg font-bold transition-shadow duration-200 ${
                      memberSpeaking ? 'speaking-glow' : ''
                    }`}
                    style={{ backgroundColor: member.avatarColor }}
                  >
                    {member.username[0].toUpperCase()}
                  </div>
                  {((isSelf && isMuted) || member.muted) && (
                    <div className="absolute -bottom-0.5 -right-0.5 w-5 h-5 bg-discord-red rounded-full flex items-center justify-center border-2 border-discord-chat">
                      <svg className="w-3 h-3 text-white" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z" />
                      </svg>
                    </div>
                  )}
                </div>
                <span className={`text-[12px] truncate max-w-full ${isSelf ? 'text-white font-medium' : 'text-discord-muted'}`}>
                  {member.username}
                </span>
              </div>
            );
          })}
        </div>

        {/* Jukebox */}
        {sharingUser && (
          <div className="mt-4 max-w-sm mx-auto">
            <JukeboxCard
              sharingUser={sharingUser}
              isSharing={isSharing}
              musicVolume={musicVolume}
              setMusicVolume={setMusicVolume}
              shareVolume={shareVolume}
              setShareVolume={setShareVolume}
              musicAnalyserRef={musicAnalyserRef}
            />
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center justify-center gap-6 px-4 py-4 border-t border-black/30 flex-shrink-0">
        <button
          onClick={toggleMute}
          className={`w-14 h-14 rounded-full flex items-center justify-center transition-colors ${
            isMuted
              ? 'bg-discord-red text-white'
              : 'bg-discord-darker text-discord-text hover:bg-discord-hover'
          }`}
          title={isMuted ? 'Unmute' : 'Mute'}
        >
          <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
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
            className={`w-14 h-14 rounded-full flex items-center justify-center transition-colors ${
              isSharing
                ? 'bg-discord-green text-white'
                : sharingUser
                  ? 'bg-discord-darker text-discord-muted/40 cursor-not-allowed'
                  : 'bg-discord-darker text-discord-text hover:bg-discord-hover'
            }`}
            title={isSharing ? 'Stop sharing' : 'Share audio'}
          >
            <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
            </svg>
          </button>
        )}
        <button
          onClick={onVoiceLeave}
          className="w-14 h-14 rounded-full flex items-center justify-center bg-discord-red text-white hover:bg-discord-red/80 transition-colors"
          title="Disconnect"
        >
          <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.956.956 0 0 1-.29-.7c0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28a11.27 11.27 0 0 0-2.67-1.85.996.996 0 0 1-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
