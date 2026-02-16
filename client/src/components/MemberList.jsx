import { useState, useCallback, useRef, useEffect } from 'react';
import StatusDot, { STATUS_CONFIG } from './StatusDot.jsx';
import ContextMenu from './ContextMenu.jsx';

const STATUS_GROUPS = [
  { key: 'online', label: 'Online' },
  { key: 'away', label: 'Away' },
  { key: 'busy', label: 'Do Not Disturb' },
  { key: 'offline', label: 'Offline' },
];

export default function MemberList({ users, currentUser, onOpenDM, user, userStatus, onStatusChange, onLogout, voiceState, voiceChannel }) {
  const [collapsed, setCollapsed] = useState({});
  const [contextMenu, setContextMenu] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showStatusPicker, setShowStatusPicker] = useState(false);
  const settingsRef = useRef(null);
  const statusRef = useRef(null);

  const {
    isSpeaking, micLevel, sensitivity, setSensitivity,
    sensitivityMode, setSensitivityMode, noiseSuppression, setNoiseSuppression,
  } = voiceState || {};

  const handleContextMenu = useCallback((e, u) => {
    e.preventDefault();
    if (u.username === currentUser) return;
    setContextMenu({ x: e.clientX, y: e.clientY, user: u });
  }, [currentUser]);

  const handleClick = useCallback((e, u) => {
    if (u.username === currentUser) return;
    setContextMenu({ x: e.clientX, y: e.clientY, user: u });
  }, [currentUser]);

  // Close popovers on click outside
  useEffect(() => {
    if (!showSettings && !showStatusPicker) return;
    function handleOutsideClick(e) {
      if (showSettings && settingsRef.current && !settingsRef.current.contains(e.target)) {
        setShowSettings(false);
      }
      if (showStatusPicker && statusRef.current && !statusRef.current.contains(e.target)) {
        setShowStatusPicker(false);
      }
    }
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [showSettings, showStatusPicker]);

  const grouped = {};
  for (const group of STATUS_GROUPS) {
    grouped[group.key] = [];
  }
  for (const u of users) {
    const status = u.status || 'online';
    const groupKey = grouped[status] ? status : 'offline';
    grouped[groupKey].push(u);
  }

  const statusConfig = STATUS_CONFIG[userStatus] || STATUS_CONFIG.online;

  return (
    <div className="w-full sm:w-60 h-full bg-discord-darker flex-shrink-0 flex flex-col border-l border-black/30 pb-14 sm:pb-0">
      {/* Member list */}
      <div className="flex-1 overflow-y-auto">
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
                    {groupUsers.map((u) => (
                      <div
                        key={u.socketId || u.username}
                        onClick={(e) => handleClick(e, u)}
                        onContextMenu={(e) => handleContextMenu(e, u)}
                        className={`flex items-center gap-3 px-2 py-1.5 rounded hover:bg-discord-hover/60 transition-colors cursor-pointer group ${
                          key === 'offline' ? 'opacity-50' : ''
                        }`}
                      >
                        <div className="relative flex-shrink-0">
                          <div
                            className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold"
                            style={{ backgroundColor: u.avatarColor }}
                          >
                            {u.username[0].toUpperCase()}
                          </div>
                          <div className="absolute -bottom-0.5 -right-0.5 border-2 border-discord-darker rounded-full">
                            <StatusDot status={u.status || 'online'} className="w-3 h-3" />
                          </div>
                        </div>
                        <span className="text-sm text-discord-muted group-hover:text-discord-text transition-colors truncate font-medium">
                          {u.username}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* User bar — pinned bottom */}
      {user && (
        <div className="relative px-2 py-2 bg-discord-dark/80 border-t border-black/40 flex-shrink-0" ref={settingsRef}>
          {/* Settings popover */}
          {showSettings && (
            <div className="absolute bottom-full left-2 right-2 mb-2 bg-discord-dark rounded-lg shadow-2xl border border-white/10 p-3 z-50">
              <div className="text-[11px] font-bold text-discord-muted uppercase tracking-wide mb-3">
                Voice Settings
              </div>
              <div className="mb-1">
                <div className="flex items-center justify-between mb-1.5">
                  <div>
                    <div className="text-[12px] text-discord-text">Input Sensitivity</div>
                    <div className="text-[10px] text-discord-muted/60 mt-0.5">
                      {(sensitivityMode ?? 'auto') === 'auto' ? 'Automatically determined' : 'Manual threshold'}
                    </div>
                  </div>
                  <button
                    onClick={() => setSensitivityMode?.((sensitivityMode ?? 'auto') === 'auto' ? 'manual' : 'auto')}
                    className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${
                      (sensitivityMode ?? 'auto') === 'auto' ? 'bg-discord-green' : 'bg-discord-muted/30'
                    }`}
                  >
                    <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                      (sensitivityMode ?? 'auto') === 'auto' ? 'translate-x-4' : 'translate-x-0.5'
                    }`} />
                  </button>
                </div>
                {(sensitivityMode ?? 'auto') === 'manual' && (
                  <div className="mt-2">
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[11px] text-discord-muted">Threshold</label>
                      <span className="text-[11px] text-discord-muted tabular-nums">{sensitivity ?? 50}%</span>
                    </div>
                    <input type="range" min="0" max="100" value={sensitivity ?? 50}
                      onChange={(e) => setSensitivity?.(Number(e.target.value))}
                      className="voice-slider w-full" />
                  </div>
                )}
              </div>
              <div className="mt-3 pt-3 border-t border-white/5">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-[12px] text-discord-text">Noise Suppression</div>
                    <div className="text-[10px] text-discord-muted/60 mt-0.5">AI-powered background noise removal</div>
                  </div>
                  <button
                    onClick={() => setNoiseSuppression?.(!noiseSuppression)}
                    className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${
                      noiseSuppression ? 'bg-discord-green' : 'bg-discord-muted/30'
                    }`}
                  >
                    <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                      noiseSuppression ? 'translate-x-4' : 'translate-x-0.5'
                    }`} />
                  </button>
                </div>
              </div>
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
            </div>
          )}

          {/* Status picker */}
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
      )}

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
