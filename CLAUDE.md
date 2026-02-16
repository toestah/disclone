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

# Deploy to Cloudron (fresh install)
cloudron install --location disclone.datapulsecorp.com --image ghcr.io/toestah/disclone:<tag>

# Deploy to Cloudron (update existing)
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
- `speakingState` / `mutedState` — socketId → boolean

Channels are hardcoded: 2 text (`general`, `random`), 2 voice (`voice-chat-1`, `voice-chat-2`).

**REST endpoint**: `GET /api/ice-servers` returns STUN servers + optional TURN (configured via `TURN_URLS`, `TURN_USERNAME`, `TURN_CREDENTIAL` env vars).

**WebRTC signaling**: Socket.IO relays `webrtc:offer`, `webrtc:answer`, and `webrtc:ice-candidate` events between peers with room membership validation. No audio data passes through the server.

### Client

**`App.jsx`** — Top-level state orchestrator. Manages user, channels, messages, online users, and voice state. Listens for all Socket.IO events and passes state down as props. Calls `useVoice(voiceChannel)` and passes the result to child components.

**Layout**: 3-column — Sidebar (240px) | TextChannel (flex) | MemberList (240px, hidden on small screens). Voice controls (mute, disconnect, settings popover with sensitivity slider) live in the Sidebar's bottom user bar — **not** in `VoiceChannel.jsx` (which exists but is currently unused/not rendered).

**Components**: `LoginScreen`, `Sidebar`, `TextChannel`, `VoiceChannel` (unused), `MemberList`, `UserAvatar` (shared avatar with speaking glow + muted badge).

### Voice System (`hooks/useVoice.js` — WebRTC P2P mesh)

This is the most complex part of the codebase. Voice uses WebRTC peer connections for direct UDP audio between clients. Socket.IO is only used for signaling (offer/answer/ICE candidate exchange).

**Local audio chain**: `getUserMedia (echoCancellation, noiseSuppression, autoGainControl)` → `AudioContext (48kHz)` → `HighPass (80Hz)` → `Presence EQ (2.5kHz)` → `DenoiseWorklet (RNNoise)` → `AnalyserNode` → `GainNode (always 1)` → `MediaStreamDestination` → `addTrack()` to each RTCPeerConnection.

**DenoiseWorklet** (`public/denoise-processor.js`): Accumulates 128-sample render quanta into 480-sample (10ms) frames, posts to main thread for RNNoise WASM processing, receives denoised audio back via FIFO. Has bypass mode (passthrough) when noise suppression is disabled.

**Remote audio chain** (per peer): `PC.ontrack` → `MediaStreamSource` → `AnalyserNode (speaking detection)` → `StereoPannerNode (spatial)` → `masterCompressor` → `destination`.

**VAD**: AnalyserNode polled every 50ms for speaking indicator UI only. RNNoise provides vadProb when noise suppression enabled, otherwise RMS dB threshold. VAD does NOT gate audio — RNNoise denoises the signal and Opus DTX handles silence efficiently.

**Signaling flow**: Existing peers create offers to new joiners (avoids glare). Client registers signaling listeners BEFORE emitting `voice:join` so no offers are missed.

**SDP munging**: After createOffer/createAnswer, Opus params are set: `maxaveragebitrate=64000`, `useinbandfec=1`, `usedtx=1`.

**ICE**: Fetches config from `/api/ice-servers` at init. STUN-only by default (Google STUN servers). TURN available via server env vars.

**Music sharing**: Uses Socket.IO relay (separate from voice). Music capture/playback worklets (`music-capture-processor.js`, `music-playback-processor.js`) unchanged.

### Socket.IO Hook (`hooks/useSocket.jsx`)

Context-based singleton. Uses `.jsx` extension (required — esbuild loader needs it for JSX). Auto-reconnect with 5 attempts.

## Key Conventions

- **Tailwind CSS v4**: Uses `@tailwindcss/vite` plugin — no `tailwind.config.js` or `postcss.config.js`. Custom theme colors defined via `@theme` directive in `index.css`. Never add unlayered `* { margin/padding: 0 }` resets — they override all Tailwind utilities since Tailwind v4 uses `@layer`.
- **JSX files**: Must use `.jsx` extension when containing JSX (Vite/esbuild requirement).
- **ES Modules**: Both server and client use ESM (`"type": "module"` in package.json).
- **AudioWorklets**: Located in `client/public/` (served as static files, not bundled by Vite). They run on the audio thread and communicate with main thread via `port.postMessage`.
- **Vite config**: `define: { global: 'globalThis' }` polyfills Node globals for socket.io-client in browser.
- **ESLint**: Flat config (v9 style) in `client/eslint.config.js`. `no-unused-vars` ignores vars matching `^[A-Z_]`.
- **Dev HTTPS**: `certs/` directory has self-signed SSL for local HTTPS testing (gitignored).
- **Production**: Docker image runs `node server/index.js` on port 3000. Server serves built client from `client/dist/` with aggressive caching for hashed assets and no-cache for HTML. SPA fallback (`app.get('*')`) serves `index.html`.
- **Cloudron**: Deployed at `disclone.datapulsecorp.com`. Manifest in `CloudronManifest.json` (httpPort 3000, no port bindings). GHCR package: `ghcr.io/toestah/disclone`.
