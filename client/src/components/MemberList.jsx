export default function MemberList({ users }) {
  return (
    <div className="w-60 bg-discord-darker flex-shrink-0 overflow-y-auto hidden lg:block border-l border-black/30">
      <div className="pt-6 px-2">
        <h3 className="text-[11px] font-bold text-discord-muted uppercase tracking-wide px-2 mb-2">
          Online &mdash; {users.length}
        </h3>
        <div className="space-y-px">
          {users.map((user) => (
            <div
              key={user.socketId}
              className="flex items-center gap-3 px-2 py-1.5 rounded hover:bg-discord-hover/60 transition-colors cursor-pointer group"
            >
              <div className="relative flex-shrink-0">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold"
                  style={{ backgroundColor: user.avatarColor }}
                >
                  {user.username[0].toUpperCase()}
                </div>
                <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-discord-green rounded-full border-2 border-discord-darker" />
              </div>
              <span className="text-sm text-discord-muted group-hover:text-discord-text transition-colors truncate font-medium">
                {user.username}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
