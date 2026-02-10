import { useState, useEffect } from 'react';

export default function LoginScreen({ onLogin, connected, error }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('disclone_session');
    if (saved) {
      try {
        const { username: savedUser } = JSON.parse(saved);
        if (savedUser) setUsername(savedUser);
      } catch {
        /* ignore */
      }
    }
  }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!username.trim()) return;
    onLogin(username.trim(), showPassword ? password : undefined);
  };

  return (
    <div className="flex items-center justify-center h-screen w-screen bg-discord-dark">
      <form
        onSubmit={handleSubmit}
        className="bg-discord-darker p-8 rounded-lg shadow-xl w-full max-w-md"
      >
        <h1 className="text-2xl font-bold text-white mb-2 text-center">
          Welcome to Disclone
        </h1>
        <p className="text-discord-muted text-center mb-6">
          Pick a username to get started
        </p>

        {error && (
          <div className="bg-discord-red/20 text-discord-red p-3 rounded mb-4 text-sm">
            {error}
          </div>
        )}

        <label className="block text-xs font-semibold text-discord-muted uppercase mb-2">
          Username
        </label>
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          maxLength={20}
          className="w-full p-3 bg-discord-input rounded text-white outline-none focus:ring-2 focus:ring-discord-accent mb-4"
          placeholder="Enter your username"
          autoFocus
        />

        <label className="flex items-center gap-2 text-sm text-discord-muted mb-4 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showPassword}
            onChange={(e) => setShowPassword(e.target.checked)}
            className="rounded"
          />
          Claim this username with a password
        </label>

        {showPassword && (
          <>
            <label className="block text-xs font-semibold text-discord-muted uppercase mb-2">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full p-3 bg-discord-input rounded text-white outline-none focus:ring-2 focus:ring-discord-accent mb-4"
              placeholder="Set a password (optional)"
            />
          </>
        )}

        <button
          type="submit"
          disabled={!connected || !username.trim()}
          className="w-full p-3 bg-discord-accent text-white font-semibold rounded hover:bg-discord-accent/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {connected ? 'Enter Disclone' : 'Connecting...'}
        </button>
      </form>
    </div>
  );
}
