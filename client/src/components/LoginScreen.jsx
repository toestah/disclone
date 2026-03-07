import { useState } from 'react';

function getSavedUsername() {
  try {
    const saved = localStorage.getItem('disclone_session');
    if (saved) {
      const { username } = JSON.parse(saved);
      return username || '';
    }
  } catch { /* ignore */ }
  return '';
}

export default function LoginScreen({ onLogin, connected, error }) {
  const [username, setUsername] = useState(getSavedUsername);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!username.trim()) return;
    onLogin(username.trim(), showPassword ? password : undefined);
  };

  return (
    <div className="flex items-center justify-center h-screen w-screen bg-discord-dark">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(88,101,242,0.15),transparent_50%)] login-breathe" />
      <form
        onSubmit={handleSubmit}
        className="relative bg-discord-chat p-8 rounded-2xl shadow-2xl w-full max-w-md border border-white/[0.06]"
      >
        {/* Logo */}
        <div className="flex justify-center mb-5">
          <div className="w-14 h-14 bg-discord-accent rounded-xl flex items-center justify-center shadow-lg shadow-discord-accent/20">
            <svg className="w-8 h-8 text-white" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 3a1 1 0 0 0-1.707-.707L5.586 7H4a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h1.586l4.707 4.707A1 1 0 0 0 12 21V3z" />
              <path d="M16.243 7.757a6 6 0 0 1 0 8.486M19.07 4.93a10 10 0 0 1 0 14.142" opacity="0.6" />
            </svg>
          </div>
        </div>

        <h1 className="text-2xl font-bold text-white mb-1 text-center">
          Welcome to Disclone
        </h1>
        <p className="text-discord-muted text-sm text-center mb-8">
          Pick a username to start chatting
        </p>

        {error && (
          <div className="bg-discord-red/10 border border-discord-red/20 text-discord-red px-4 py-3 rounded-lg mb-5 text-sm">
            {error}
          </div>
        )}

        <label className="block text-xs font-bold text-discord-muted uppercase tracking-wide mb-2">
          Username
        </label>
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          maxLength={20}
          className="w-full px-4 py-2.5 bg-discord-dark rounded-lg text-white outline-none border border-discord-border focus:border-discord-accent transition-colors mb-5 placeholder:text-discord-muted/60"
          placeholder="Enter your username"
          autoFocus
        />

        <label className="flex items-center gap-2.5 text-sm text-discord-text mb-5 cursor-pointer select-none group">
          <div className={`w-4.5 h-4.5 rounded border-2 flex items-center justify-center transition-colors ${showPassword ? 'bg-discord-accent border-discord-accent' : 'border-discord-muted/60 group-hover:border-discord-muted'}`}>
            {showPassword && (
              <svg className="w-3 h-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </div>
          <input
            type="checkbox"
            checked={showPassword}
            onChange={(e) => setShowPassword(e.target.checked)}
            className="sr-only"
          />
          Claim this username with a password
        </label>

        {showPassword && (
          <div className="mb-5">
            <label className="block text-xs font-bold text-discord-muted uppercase tracking-wide mb-2">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-2.5 bg-discord-dark rounded-lg text-white outline-none border border-discord-border focus:border-discord-accent transition-colors placeholder:text-discord-muted/60"
              placeholder="Set a password"
            />
          </div>
        )}

        <button
          type="submit"
          disabled={!connected || !username.trim()}
          className="w-full py-2.5 bg-discord-accent text-white font-semibold rounded-lg hover:bg-[#4752c4] active:translate-y-px transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-discord-accent"
        >
          {connected ? 'Continue' : 'Connecting...'}
        </button>
      </form>
    </div>
  );
}
