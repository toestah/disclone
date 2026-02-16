const STATUS_CONFIG = {
  online: { label: 'Online', color: 'bg-discord-green', textColor: 'text-discord-green' },
  away: { label: 'Away', color: 'bg-discord-yellow', textColor: 'text-discord-yellow' },
  busy: { label: 'Do Not Disturb', color: 'bg-discord-red', textColor: 'text-discord-red' },
  invisible: { label: 'Invisible', color: 'bg-discord-muted/60', textColor: 'text-discord-muted' },
  offline: { label: 'Offline', color: 'bg-discord-muted/60', textColor: 'text-discord-muted' },
};

function StatusDot({ status, className = '' }) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.online;
  if (status === 'busy') {
    return (
      <div className={`${config.color} rounded-full flex items-center justify-center ${className}`}>
        <div className="w-1.5 h-0.5 bg-discord-dark rounded-full" />
      </div>
    );
  }
  if (status === 'away') {
    return (
      <div className={`${config.color} rounded-full relative ${className}`}>
        <div className="absolute top-0.5 left-0.5 w-1.5 h-1.5 bg-discord-dark rounded-full" />
      </div>
    );
  }
  return <div className={`${config.color} rounded-full ${className}`} />;
}

export default StatusDot;
export { STATUS_CONFIG };
