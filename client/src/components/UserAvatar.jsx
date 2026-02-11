export default function UserAvatar({
  username,
  avatarColor,
  speaking,
  isSelf,
  isMuted,
  small,
}) {
  const size = small ? 'w-9 h-9 text-sm' : 'w-14 h-14 text-lg';
  const badgeSize = small ? 'w-2.5 h-2.5' : 'w-3 h-3';

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative">
        <div
          className={`${size} rounded-full flex items-center justify-center text-white font-bold transition-all duration-200 ${
            speaking ? 'speaking-glow' : 'ring-2 ring-transparent'
          }`}
          style={{ backgroundColor: avatarColor }}
        >
          {username[0].toUpperCase()}
        </div>
        {isMuted && (
          <div className="absolute -bottom-0.5 -right-0.5 bg-discord-red rounded-full p-[2px] border-2 border-discord-chat">
            <svg
              className={`${badgeSize} text-white`}
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z" />
            </svg>
          </div>
        )}
      </div>
      <span
        className={`text-[11px] leading-tight max-w-[72px] truncate ${isSelf ? 'text-white font-semibold' : 'text-discord-muted'}`}
      >
        {username}
        {isSelf && ' (you)'}
      </span>
    </div>
  );
}
