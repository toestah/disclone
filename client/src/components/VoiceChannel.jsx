import useVoice from '../hooks/useVoice.js';
import UserAvatar from './UserAvatar.jsx';

export default function VoiceChannel({ channelId, channelName, members, onLeave, user }) {
  const { isMuted, isSpeaking, micLevel, testing, toggleMute, toggleTest, speakingPeers } =
    useVoice(channelId);

  return (
    <div className="border-t border-black/30 bg-discord-dark/50 p-4 flex-shrink-0">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-discord-green">{channelName}</h3>
          <p className="text-xs text-discord-muted">Voice Connected</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Mic test button */}
          <button
            onClick={toggleTest}
            className={`p-2 rounded-full transition-colors ${
              testing
                ? 'bg-discord-accent hover:bg-discord-accent/80'
                : 'bg-discord-input hover:bg-white/20'
            }`}
            title={testing ? 'Stop mic test' : 'Test mic (hear yourself)'}
          >
            <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3zM1 12h2a9 9 0 0 0 18 0h2a11 11 0 0 1-10 10.95V23h-2v-.05A11 11 0 0 1 1 12z" />
            </svg>
          </button>
          {/* Mute button */}
          <button
            onClick={toggleMute}
            className={`p-2 rounded-full transition-colors ${
              isMuted
                ? 'bg-discord-red hover:bg-discord-red/80'
                : 'bg-discord-input hover:bg-white/20'
            }`}
            title={isMuted ? 'Unmute' : 'Mute'}
          >
            <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="currentColor">
              {isMuted ? (
                <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z" />
              ) : (
                <path d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z" />
              )}
            </svg>
          </button>
          {/* Disconnect button */}
          <button
            onClick={onLeave}
            className="p-2 rounded-full bg-discord-red hover:bg-discord-red/80 transition-colors"
            title="Disconnect"
          >
            <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.956.956 0 0 1-.29-.7c0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28a11.27 11.27 0 0 0-2.67-1.85.996.996 0 0 1-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Mic level meter */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs text-discord-muted w-8">Mic</span>
        <div className="flex-1 h-2 bg-discord-input rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-75"
            style={{
              width: `${micLevel}%`,
              backgroundColor:
                micLevel > 70 ? '#ed4245' : micLevel > 30 ? '#faa61a' : '#3ba55c',
            }}
          />
        </div>
        {testing && (
          <span className="text-xs text-discord-accent animate-pulse">Listening...</span>
        )}
      </div>

      {/* User bubbles in a row */}
      <div className="flex flex-wrap gap-3">
        {members.map((member) => {
          const self = member.username === user.username;
          return (
            <UserAvatar
              key={member.socketId}
              username={member.username}
              avatarColor={member.avatarColor}
              speaking={
                self ? isSpeaking : speakingPeers.has(member.socketId) || member.speaking
              }
              isSelf={self}
              isMuted={self && isMuted}
              small
            />
          );
        })}
      </div>
    </div>
  );
}
