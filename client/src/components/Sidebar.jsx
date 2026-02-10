export default function Sidebar({
  channels,
  activeChannel,
  voiceChannel,
  voiceMembers,
  onChannelSelect,
  onVoiceJoin,
  onVoiceLeave,
  user,
}) {
  const textChannels = channels.filter((c) => c.type === 'text');
  const voiceChannels = channels.filter((c) => c.type === 'voice');

  return (
    <div className="w-60 bg-discord-darker flex flex-col h-full flex-shrink-0">
      {/* Server header */}
      <div className="h-12 px-4 flex items-center shadow-md border-b border-black/30">
        <h2 className="font-bold text-white truncate">Disclone</h2>
      </div>

      {/* Channel list */}
      <div className="flex-1 overflow-y-auto py-3 px-2">
        {/* Text channels */}
        <div className="text-xs font-semibold text-discord-muted uppercase px-2 mb-1">
          Text Channels
        </div>
        {textChannels.map((channel) => (
          <button
            key={channel.id}
            onClick={() => onChannelSelect(channel.id)}
            className={`w-full text-left px-2 py-1.5 rounded flex items-center gap-1.5 mb-0.5 transition-colors ${
              activeChannel === channel.id
                ? 'bg-white/10 text-white'
                : 'text-discord-muted hover:bg-white/5 hover:text-discord-text'
            }`}
          >
            <span className="text-lg leading-none opacity-70">#</span>
            <span className="text-sm">{channel.name}</span>
          </button>
        ))}

        {/* Voice channels */}
        <div className="text-xs font-semibold text-discord-muted uppercase px-2 mt-4 mb-1">
          Voice Channels
        </div>
        {voiceChannels.map((channel) => {
          const members = voiceMembers.get(channel.id) || [];
          const isJoined = voiceChannel === channel.id;
          return (
            <div key={channel.id} className="mb-1">
              <button
                onClick={() =>
                  isJoined ? onVoiceLeave() : onVoiceJoin(channel.id)
                }
                className={`w-full text-left px-2 py-1.5 rounded flex items-center gap-1.5 transition-colors ${
                  isJoined
                    ? 'bg-white/10 text-discord-green'
                    : 'text-discord-muted hover:bg-white/5 hover:text-discord-text'
                }`}
              >
                <svg
                  className="w-5 h-5 flex-shrink-0"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M12 3a1 1 0 0 0-1.707-.707L5.586 7H4a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h1.586l4.707 4.707A1 1 0 0 0 12 21V3z" />
                </svg>
                <span className="text-sm">{channel.name}</span>
                {members.length > 0 && (
                  <span className="ml-auto text-xs text-discord-muted">
                    {members.length}
                  </span>
                )}
              </button>
              {members.length > 0 && (
                <div className="pl-8 py-1 space-y-1">
                  {members.map((member) => (
                    <div
                      key={member.socketId}
                      className="flex items-center gap-2 text-xs text-discord-muted"
                    >
                      <div
                        className="w-5 h-5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: member.avatarColor }}
                      />
                      <span className="truncate">{member.username}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* User bar */}
      <div className="h-14 bg-discord-dark/50 px-2 flex items-center gap-2 border-t border-black/30">
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
          style={{ backgroundColor: user.avatarColor }}
        >
          {user.username[0].toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-white truncate">
            {user.username}
          </div>
          <div className="text-xs text-discord-green">Online</div>
        </div>
        {voiceChannel && (
          <button
            onClick={onVoiceLeave}
            className="text-discord-red hover:text-white transition-colors p-1"
            title="Disconnect from voice"
          >
            <svg
              className="w-5 h-5"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.956.956 0 0 1-.29-.7c0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28a11.27 11.27 0 0 0-2.67-1.85.996.996 0 0 1-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
