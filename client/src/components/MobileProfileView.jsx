import StatusDot, { STATUS_CONFIG } from './StatusDot.jsx';
import VoiceSettings from './VoiceSettings.jsx';

export default function MobileProfileView({ user, userStatus, onStatusChange, onLogout, voiceState, voiceChannel, sounds }) {
  const statusConfig = STATUS_CONFIG[userStatus] || STATUS_CONFIG.online;

  if (!user) return null;

  return (
    <div className="flex flex-col h-full bg-discord-darker pb-14">
      {/* Header */}
      <div className="h-12 px-4 flex items-center border-b border-black/30 flex-shrink-0">
        <span className="font-bold text-white text-[15px]">My Profile</span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6">
        {/* Avatar + name */}
        <div className="flex flex-col items-center mb-6">
          <div
            className="w-20 h-20 rounded-full flex items-center justify-center text-white text-2xl font-bold mb-3"
            style={{ backgroundColor: user.avatarColor }}
          >
            {user.username[0].toUpperCase()}
          </div>
          <div className="text-lg font-semibold text-white">{user.username}</div>
          <div className={`text-sm ${statusConfig.textColor} flex items-center gap-1.5 mt-1`}>
            <StatusDot status={userStatus || 'online'} className="w-3 h-3" />
            {statusConfig.label}
          </div>
        </div>

        {/* Status picker */}
        <div className="bg-discord-dark/60 rounded-lg p-3 mb-4">
          <div className="text-[11px] font-bold text-discord-muted uppercase tracking-wide mb-2">Status</div>
          <div className="space-y-1">
            {Object.entries(STATUS_CONFIG).map(([key, config]) => (
              <button
                key={key}
                onClick={() => onStatusChange?.(key)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-left transition-colors ${
                  userStatus === key
                    ? 'bg-discord-active text-white'
                    : 'text-discord-text hover:bg-discord-hover'
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
        </div>

        {/* Voice & sound settings */}
        <div className="bg-discord-dark/60 rounded-lg p-3 mb-4">
          <div className="text-[11px] font-bold text-discord-muted uppercase tracking-wide mb-3">
            Voice Settings
          </div>
          <VoiceSettings voiceState={voiceState} voiceChannel={voiceChannel} sounds={sounds} />
        </div>

        {/* Logout */}
        <button
          onClick={onLogout}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-discord-red/10 text-discord-red hover:bg-discord-red/20 transition-colors"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M10.09 15.59L11.5 17l5-5-5-5-1.41 1.41L12.67 11H3v2h9.67l-2.58 2.59zM19 3H5c-1.11 0-2 .9-2 2v4h2V5h14v14H5v-4H3v4c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z" />
          </svg>
          <span className="text-[14px] font-medium">Log Out</span>
        </button>

        <div className="mt-4 text-center">
          <span className="text-[10px] text-discord-muted/40">Disclone v{__APP_VERSION__}</span>
        </div>
      </div>
    </div>
  );
}
