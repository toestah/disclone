export default function MemberList({ users }) {
  return (
    <div className="w-60 bg-discord-darker flex-shrink-0 overflow-y-auto hidden lg:block border-l border-black/30">
      <div className="p-4">
        <h3 className="text-xs font-semibold text-discord-muted uppercase mb-3">
          Online &mdash; {users.length}
        </h3>
        <div className="space-y-0.5">
          {users.map((user) => (
            <div
              key={user.socketId}
              className="flex items-center gap-3 px-2 py-1.5 rounded hover:bg-white/5"
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
              <span className="text-sm text-discord-text truncate">
                {user.username}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
