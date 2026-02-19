# Disclone

A free, lightweight, private communication platform. Text, voice, screen sharing, and music sharing — with no accounts required, no data collection, no ads, and no bullshit.

Disclone is an open love letter to how communication tools should work. Privacy and connection are for everyone. Software doesn't need to be bloated, addictive, or designed to mine your data. It can be simple, clean, beautiful, and noble.

Spin it up. Talk to your friends, your colleagues, the people you care about. That's it. That's the whole thing.

---

## Why Disclone?

Every major communication platform follows the same playbook: capture users, then monetize their attention and data. Premium tiers, engagement metrics, notification dark patterns, phone number verification, mandatory accounts, data harvesting.

Disclone takes a different path:

- **No accounts required.** Pick a username and go. Passwords are optional.
- **No database.** All state lives in memory and vanishes when the server restarts. There is nothing to leak, breach, or subpoena.
- **No analytics or tracking.** Zero telemetry. Zero fingerprinting. The server doesn't care who you are.
- **No ads, no premium tiers, no upsells.** The whole thing is the whole thing.
- **Voice and screen sharing are peer-to-peer.** Your audio and video go directly between browsers. The server never sees or touches your media. Ever.

## Features

- **Text Chat** — Real-time messaging with image attachments, message reactions, and direct messages
- **Voice Chat** — WebRTC peer-to-peer with RNNoise denoising, spatial audio, and Opus DTX
- **Screen Sharing** — P2P video streaming at up to 1080p60 with fullscreen viewer
- **Music Sharing** — Share audio from a browser tab to the whole voice channel
- **Mobile Friendly** — Responsive layout with dedicated mobile voice and profile views

## Privacy Model

This is the part that matters.

### Voice & Screen Sharing — End-to-End Encrypted

Voice and screen sharing use **WebRTC peer connections** between browsers. All media is encrypted with **DTLS-SRTP** — this is mandatory in the WebRTC specification and cannot be disabled. Your audio and video travel directly between participants over encrypted UDP. The server's only role is signaling: helping browsers find each other. Once connected, the server is completely out of the loop.

**No one — not the server, not the host, not anyone between you and the person you're talking to — can listen to your voice calls or see your screen shares.**

### Text Chat — Encrypted in Transit

Text messages are encrypted between your browser and the server via TLS (HTTPS/WSS). A network attacker cannot read them. However, text is **not** end-to-end encrypted — the server process handles messages in plaintext in memory in order to relay them. If you control the server (and you should — that's the point of self-hosting), this is a non-issue.

### What the Server Sees

| Data | Server can see? | Encrypted in transit? | End-to-end encrypted? |
|---|---|---|---|
| Voice audio | No | Yes (TLS + DTLS-SRTP) | **Yes** |
| Screen video | No | Yes (TLS + DTLS-SRTP) | **Yes** |
| Text messages | Yes (in memory) | Yes (TLS) | No |
| Music audio | Yes (relayed) | Yes (TLS) | No |
| Who's online | Yes | Yes (TLS) | N/A |

### What Disclone Does NOT Do

- Does not store messages to disk
- Does not log message content
- Does not record or process voice/video
- Does not collect email addresses or phone numbers
- Does not use cookies for tracking
- Does not send data to third parties
- Does not phone home

## Self-Hosting

Disclone is designed to be self-hosted. You run it, you control it, you own it.

### Quick Start (Development)

```bash
git clone https://github.com/toestah/disclone.git
cd disclone
npm install
npm --prefix server install
npm --prefix client install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). Server runs on port 3001, Vite proxies Socket.IO automatically.

### Production (Docker)

```bash
docker build -t disclone .
docker run -p 3000:3000 disclone
```

The server serves the built client on port 3000. Set `PORT` to change it.

### TURN Server (Optional)

WebRTC peer-to-peer connections work through most home NATs with just STUN (included by default via Google's public STUN servers). If your users are behind strict corporate firewalls, you can add a TURN relay:

```bash
TURN_URLS=turn:your-turn-server:3478 \
TURN_USERNAME=user \
TURN_CREDENTIAL=pass \
node server/index.js
```

### Cloudron

Disclone includes a `CloudronManifest.json` for one-click deployment on [Cloudron](https://www.cloudron.io/).

```bash
# Build and push
docker buildx build --platform linux/amd64,linux/arm64 -t ghcr.io/youruser/disclone:v1.0.0 --push .

# Install
cloudron install --location chat.yourdomain.com --image ghcr.io/youruser/disclone:v1.0.0

# Update
cloudron update --app chat.yourdomain.com --image ghcr.io/youruser/disclone:v1.0.0
```

## Architecture

The entire server is a single file: `server/index.js`. The entire client is a handful of React components and one custom hook for voice. There is no database. There is no build pipeline beyond Vite. You can read the whole thing in an afternoon.

```
Client (React + Vite)              Server (Node.js + Express + Socket.IO)
┌─────────────────────┐            ┌──────────────────────────┐
│  App.jsx             │◄──WSS────►│  server/index.js          │
│  ├─ Sidebar          │           │  ├─ In-memory Maps        │
│  ├─ TextChannel      │           │  ├─ Socket.IO events      │
│  ├─ MemberList       │           │  ├─ WebRTC signaling      │
│  └─ ScreenViewer     │           │  └─ REST: /api/ice-servers│
│                      │           └──────────────────────────┘
│  useVoice.js         │
│  ├─ getUserMedia     │           Voice/Screen: Direct P2P
│  ├─ RNNoise denoise  │           ┌─────────┐    ┌─────────┐
│  ├─ WebRTC P2P  ─────┼──UDP/SRTP─┤ Browser ◄────► Browser │
│  └─ Screen share     │           └─────────┘    └─────────┘
└─────────────────────┘
```

**Tech stack:** React 19, Vite, Tailwind CSS v4, Node.js, Express, Socket.IO, WebRTC, RNNoise WASM, Web Audio API.

## Contributing

This project exists because communication should be free, private, and accessible to everyone. If that resonates with you, contributions are welcome.

## License

MIT
