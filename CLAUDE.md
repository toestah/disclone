# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
# Run both client + server in development (from root)
npm run dev

# Run server only (with --watch for auto-reload)
npm --prefix server run dev        # port 3001

# Run client only (Vite dev server)
npm --prefix client run dev        # port 5173, proxies /socket.io → localhost:3001

# Production build (client only, outputs to client/dist/)
npm run build

# Run production server (serves built client + API on same port)
node server/index.js               # PORT env, default 3000

# Lint client
npm --prefix client run lint

# Docker build (multi-arch for Cloudron deployment)
docker buildx build --platform linux/amd64,linux/arm64 -t ghcr.io/toestah/disclone:<tag> --push .

# Deploy to Cloudron
cloudron update --app disclone.datapulsecorp.com --image ghcr.io/toestah/disclone:<tag>
```

## Architecture

Discord clone with real-time text and voice chat. All server state is in-memory (no database). Client sessions persist via localStorage.

### Server (`server/index.js` — single file)

Express serves the built client static files in production. Socket.IO handles all real-time communication. State is stored in Maps:

- `registeredUsers` — username → {password, avatarColor}
- `activeSessions` — socketId → {username, avatarColor, currentChannel}
- `messageHistory` — channelId → Message[] (capped at 500; returns last 100 on join)
- `voiceRooms` — channelId → Set\<socketId\>
- `clientCapabilities` — socketId → {opus: boolean}
- `speakingState` / `mutedState` — socketId → boolean

Channels are hardcoded: 2 text (`general`, `random`), 2 voice (`voice-chat-1`, `voice-chat-2`).

Audio relay: server receives `audio:chunk` events and broadcasts to the voice room via `socket.to().volatile.emit()` (lossy/real-time). It relays `codec`, `seq`, and `sampleRate` fields to support both Opus and PCM.

### Client

**`App.jsx`** — Top-level state orchestrator. Manages user, channels, messages, online users, and voice state. Listens for all Socket.IO events and passes state down as props. Calls `useVoice(voiceChannel)` and passes the result to child components.

**Layout**: 3-column — Sidebar (240px) | TextChannel (flex) | MemberList (240px, hidden on small screens). Voice controls (mute, disconnect, settings popover with sensitivity slider) live in the Sidebar's bottom user bar — **not** in `VoiceChannel.jsx` (which exists but is currently unused/not rendered).

**Components**: `LoginScreen`, `Sidebar`, `TextChannel`, `VoiceChannel` (unused), `MemberList`, `UserAvatar` (shared avatar with speaking glow + muted badge).

### Voice System (`hooks/useVoice.js` + AudioWorklets)

This is the most complex part of the codebase. The voice pipeline:

**Capture chain**: mic → HighPass(80Hz) → LowPass(12kHz) → DynamicsCompressor → CaptureWorklet (pass-through) → AnalyserNode → silentGain → destination

**CaptureWorklet** (`public/capture-processor.js`): Runs on audio thread. Accumulates 128-sample render quanta into 20ms frames, posts to main thread. Silence gate at peak < 0.0001.

**Main thread processing**: Receives frames from worklet → VAD gate (spectral analysis, 300ms hold, configurable sensitivity) → smooth fade-in/fade-out on gate transitions → encode via WebCodecs Opus (32kbps) or fall back to Int16 PCM.

**Codec negotiation**: Clients announce `{opus: boolean}` capability on `voice:join`. Sender dynamically chooses Opus (if all peers support it) or PCM. Safety guard: never interpret Opus bytes as PCM.

**PlaybackWorklet** (`public/playback-processor.js`): Per-peer ring buffers (2s each), 100ms prefill before playback starts, 5ms fade-in, 3ms exponential decay on underrun, soft clipping for multi-peer mixing.

**Receive path**: Opus → AudioDecoder → resample if needed → postMessage to PlaybackWorklet. PCM → Int16→Float32 → resample → PlaybackWorklet.

### Socket.IO Hook (`hooks/useSocket.jsx`)

Context-based singleton. Uses `.jsx` extension (required — esbuild loader needs it for JSX). Auto-reconnect with 5 attempts.

## Key Conventions

- **Tailwind CSS v4**: Uses `@tailwindcss/vite` plugin — no `tailwind.config.js` or `postcss.config.js`. Custom theme colors defined via `@theme` directive in `index.css`. Never add unlayered `* { margin/padding: 0 }` resets — they override all Tailwind utilities since Tailwind v4 uses `@layer`.
- **JSX files**: Must use `.jsx` extension when containing JSX (Vite/esbuild requirement).
- **ES Modules**: Both server and client use ESM (`"type": "module"` in package.json).
- **AudioWorklets**: Located in `client/public/` (served as static files, not bundled by Vite). They run on the audio thread and communicate with main thread via `port.postMessage`.
- **Volatile emit**: Audio chunks use `socket.volatile.emit()` — OK to drop under congestion.
- **Vite config**: `define: { global: 'globalThis' }` polyfills Node globals for socket.io-client in browser.
- **ESLint**: Flat config (v9 style) in `client/eslint.config.js`. `no-unused-vars` ignores vars matching `^[A-Z_]`.
- **Dev HTTPS**: `certs/` directory has self-signed SSL for local HTTPS testing (gitignored).
- **Production**: Docker image runs `node server/index.js` on port 3000. Server serves built client from `client/dist/` with aggressive caching for hashed assets and no-cache for HTML. SPA fallback (`app.get('*')`) serves `index.html`.
