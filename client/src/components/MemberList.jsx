import { useState, useCallback } from 'react';
import { StatusDot } from './Sidebar.jsx';
import ContextMenu from './ContextMenu.jsx';

const STATUS_GROUPS = [
  { key: 'online', label: 'Online' },
  { key: 'away', label: 'Away' },
  { key: 'busy', label: 'Do Not Disturb' },
  { key: 'offline', label: 'Offline' },
];

export default function MemberList({ users, currentUser, onOpenDM }) {
  const [collapsed, setCollapsed] = useState({});
  const [contextMenu, setContextMenu] = useState(null);

  const handleContextMenu = useCallback((e, user) => {
    e.preventDefault();
    if (user.username === currentUser) return;
    setContextMenu({ x: e.clientX, y: e.clientY, user });
  }, [currentUser]);

  const handleClick = useCallback((e, user) => {
    if (user.username === currentUser) return;
    setContextMenu({ x: e.clientX, y: e.clientY, user });
  }, [currentUser]);

  const grouped = {};
  for (const group of STATUS_GROUPS) {
    grouped[group.key] = [];
  }
  for (const user of users) {
    const status = user.status || 'online';
    const groupKey = grouped[status] ? status : 'offline';
    grouped[groupKey].push(user);
  }

  return (
    <div className="w-60 bg-discord-darker flex-shrink-0 overflow-y-auto hidden lg:block border-l border-black/30">
      <div className="pt-6 px-2">
        {STATUS_GROUPS.map(({ key, label }) => {
          const groupUsers = grouped[key];
          if (groupUsers.length === 0) return null;
          const isCollapsed = collapsed[key];
          return (
            <div key={key} className="mb-2">
              <button
                onClick={() => setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }))}
                className="w-full flex items-center gap-1 px-2 mb-1 group"
              >
                <svg
                  className={`w-2.5 h-2.5 text-discord-muted/60 transition-transform ${isCollapsed ? '-rotate-90' : ''}`}
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M7 10l5 5 5-5z" />
                </svg>
                <span className="text-[11px] font-bold text-discord-muted uppercase tracking-wide">
                  {label} &mdash; {groupUsers.length}
                </span>
              </button>
              {!isCollapsed && (
                <div className="space-y-px">
                  {groupUsers.map((user) => (
                    <div
                      key={user.socketId || user.username}
                      onClick={(e) => handleClick(e, user)}
                      onContextMenu={(e) => handleContextMenu(e, user)}
                      className={`flex items-center gap-3 px-2 py-1.5 rounded hover:bg-discord-hover/60 transition-colors cursor-pointer group ${
                        key === 'offline' ? 'opacity-50' : ''
                      }`}
                    >
                      <div className="relative flex-shrink-0">
                        <div
                          className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold"
                          style={{ backgroundColor: user.avatarColor }}
                        >
                          {user.username[0].toUpperCase()}
                        </div>
                        <div className="absolute -bottom-0.5 -right-0.5 border-2 border-discord-darker rounded-full">
                          <StatusDot status={user.status || 'online'} className="w-3 h-3" />
                        </div>
                      </div>
                      <span className="text-sm text-discord-muted group-hover:text-discord-text transition-colors truncate font-medium">
                        {user.username}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={[
            {
              label: 'Message',
              icon: (
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                  <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.17L4 17.17V4h16v12z" />
                </svg>
              ),
              onClick: () => onOpenDM?.(contextMenu.user.username),
            },
          ]}
        />
      )}
    </div>
  );
}
