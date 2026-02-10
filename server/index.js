import express from 'express';
import { createServer } from 'http';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import cors from 'cors';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());

// In production, serve the built client files
const clientDist = resolve(__dirname, '../client/dist');
app.use(express.static(clientDist));

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
  },
});

// ── In-Memory State ──────────────────────────────────────────────

// Registered users: username -> { password, avatarColor }
const registeredUsers = new Map();

// Active sessions: socket.id -> { username, avatarColor, currentChannel }
const activeSessions = new Map();

// Channel definitions
const channels = [
  { id: 'general', name: 'general', type: 'text' },
  { id: 'random', name: 'random', type: 'text' },
  { id: 'voice-chat-1', name: 'Voice Chat 1', type: 'voice' },
  { id: 'voice-chat-2', name: 'Voice Chat 2', type: 'voice' },
];

// Text message history: channelId -> Message[]
const messageHistory = new Map();
messageHistory.set('general', []);
messageHistory.set('random', []);

// Voice room participants: channelId -> Set<socketId>
const voiceRooms = new Map();
voiceRooms.set('voice-chat-1', new Set());
voiceRooms.set('voice-chat-2', new Set());

// Speaking state: socketId -> boolean
const speakingState = new Map();

let messageIdCounter = 0;

// ── Helpers ──────────────────────────────────────────────────────

const AVATAR_COLORS = [
  '#5865f2', '#57f287', '#fee75c', '#eb459e',
  '#ed4245', '#f47b67', '#e78284', '#9b59b6',
  '#1abc9c', '#e67e22', '#3498db', '#e91e63',
];

function randomAvatarColor() {
  return AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
}

function getOnlineUsers() {
  const users = [];
  for (const [socketId, session] of activeSessions) {
    users.push({
      socketId,
      username: session.username,
      avatarColor: session.avatarColor,
      currentChannel: session.currentChannel,
    });
  }
  return users;
}

function getVoiceRoomMembers(channelId) {
  const members = [];
  const room = voiceRooms.get(channelId);
  if (!room) return members;
  for (const socketId of room) {
    const session = activeSessions.get(socketId);
    if (session) {
      members.push({
        socketId,
        username: session.username,
        avatarColor: session.avatarColor,
        speaking: speakingState.get(socketId) || false,
      });
    }
  }
  return members;
}

// ── Socket.IO ────────────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log(`Connected: ${socket.id}`);

  // ── Authentication ──

  socket.on('user:login', ({ username, password }, callback) => {
    if (!username || username.trim().length === 0) {
      return callback({ success: false, error: 'Username is required' });
    }
    const trimmed = username.trim();
    if (trimmed.length > 20) {
      return callback({ success: false, error: 'Username max 20 characters' });
    }

    // Check if username is in use by another session
    for (const [sid, session] of activeSessions) {
      if (session.username === trimmed && sid !== socket.id) {
        return callback({ success: false, error: 'Username is currently in use' });
      }
    }

    // Check password for claimed usernames
    const existing = registeredUsers.get(trimmed);
    if (existing && existing.password) {
      if (!password || password !== existing.password) {
        return callback({ success: false, error: 'Incorrect password for this username' });
      }
    }

    // Register or update user
    const avatarColor = existing?.avatarColor || randomAvatarColor();
    if (password && !existing?.password) {
      registeredUsers.set(trimmed, { password, avatarColor });
    } else if (!existing) {
      registeredUsers.set(trimmed, { password: null, avatarColor });
    }

    // Create session
    activeSessions.set(socket.id, {
      username: trimmed,
      avatarColor,
      currentChannel: 'general',
    });

    socket.join('general');
    io.emit('users:update', getOnlineUsers());

    callback({
      success: true,
      user: { username: trimmed, avatarColor },
      channels,
    });
  });

  // ── Text Channels ──

  socket.on('channel:join', ({ channelId }, callback) => {
    const session = activeSessions.get(socket.id);
    if (!session) return;

    const channel = channels.find((c) => c.id === channelId && c.type === 'text');
    if (!channel) return callback?.({ success: false, error: 'Channel not found' });

    // Leave previous text channel
    const prev = session.currentChannel;
    if (prev && channels.find((c) => c.id === prev && c.type === 'text')) {
      socket.leave(prev);
    }

    socket.join(channelId);
    session.currentChannel = channelId;

    const history = messageHistory.get(channelId) || [];
    callback?.({ success: true, messages: history.slice(-100) });

    io.emit('users:update', getOnlineUsers());
  });

  socket.on('message:send', ({ channelId, content }) => {
    const session = activeSessions.get(socket.id);
    if (!session) return;
    if (!content || content.trim().length === 0) return;
    if (content.length > 2000) return;

    const message = {
      id: String(++messageIdCounter),
      username: session.username,
      avatarColor: session.avatarColor,
      content: content.trim(),
      timestamp: Date.now(),
    };

    const history = messageHistory.get(channelId);
    if (history) {
      history.push(message);
      if (history.length > 500) history.splice(0, history.length - 500);
    }

    io.to(channelId).emit('message:new', { channelId, message });
  });

  // ── Voice Channels ──

  socket.on('voice:join', ({ channelId }, callback) => {
    const session = activeSessions.get(socket.id);
    if (!session) return;

    const channel = channels.find((c) => c.id === channelId && c.type === 'voice');
    if (!channel) return callback?.({ success: false, error: 'Voice channel not found' });

    // Leave any current voice room
    for (const [roomId, room] of voiceRooms) {
      if (room.has(socket.id)) {
        room.delete(socket.id);
        socket.leave(`voice:${roomId}`);
        socket.to(`voice:${roomId}`).emit('voice:user-left', {
          channelId: roomId,
          socketId: socket.id,
        });
        io.emit('voice:room-update', {
          channelId: roomId,
          members: getVoiceRoomMembers(roomId),
        });
      }
    }

    // Join new voice room
    const room = voiceRooms.get(channelId);
    room.add(socket.id);
    socket.join(`voice:${channelId}`);

    // Existing peers
    const existingPeers = [];
    for (const peerId of room) {
      if (peerId !== socket.id) {
        const peerSession = activeSessions.get(peerId);
        if (peerSession) {
          existingPeers.push({
            socketId: peerId,
            username: peerSession.username,
            avatarColor: peerSession.avatarColor,
          });
        }
      }
    }

    // Notify existing peers
    socket.to(`voice:${channelId}`).emit('voice:user-joined', {
      channelId,
      socketId: socket.id,
      username: session.username,
      avatarColor: session.avatarColor,
    });

    callback?.({ success: true, peers: existingPeers });

    io.emit('voice:room-update', {
      channelId,
      members: getVoiceRoomMembers(channelId),
    });
    io.emit('users:update', getOnlineUsers());
  });

  socket.on('voice:leave', ({ channelId }) => {
    const session = activeSessions.get(socket.id);
    if (!session) return;

    const room = voiceRooms.get(channelId);
    if (room) {
      room.delete(socket.id);
      socket.leave(`voice:${channelId}`);
      speakingState.delete(socket.id);

      socket.to(`voice:${channelId}`).emit('voice:user-left', {
        channelId,
        socketId: socket.id,
      });

      io.emit('voice:room-update', {
        channelId,
        members: getVoiceRoomMembers(channelId),
      });
      io.emit('users:update', getOnlineUsers());
    }
  });

  // ── Voice Speaking State ──

  socket.on('voice:speaking', ({ channelId, speaking }) => {
    speakingState.set(socket.id, speaking);
    socket.to(`voice:${channelId}`).emit('voice:speaking', {
      socketId: socket.id,
      speaking,
    });
  });

  // ── WebRTC Signaling ──

  socket.on('webrtc:offer', ({ to, signal }) => {
    io.to(to).emit('webrtc:offer', { from: socket.id, signal });
  });

  socket.on('webrtc:answer', ({ to, signal }) => {
    io.to(to).emit('webrtc:answer', { from: socket.id, signal });
  });

  socket.on('webrtc:ice-candidate', ({ to, signal }) => {
    io.to(to).emit('webrtc:ice-candidate', { from: socket.id, signal });
  });

  // ── Disconnect ──

  socket.on('disconnect', () => {
    const session = activeSessions.get(socket.id);
    if (!session) return;

    console.log(`Disconnected: ${socket.id} (${session.username})`);

    for (const [roomId, room] of voiceRooms) {
      if (room.has(socket.id)) {
        room.delete(socket.id);
        socket.to(`voice:${roomId}`).emit('voice:user-left', {
          channelId: roomId,
          socketId: socket.id,
        });
        io.emit('voice:room-update', {
          channelId: roomId,
          members: getVoiceRoomMembers(roomId),
        });
      }
    }

    speakingState.delete(socket.id);
    activeSessions.delete(socket.id);
    io.emit('users:update', getOnlineUsers());
  });
});

// ── Start Server ─────────────────────────────────────────────────

// SPA fallback — serve index.html for any non-API/non-static route
app.get('*', (req, res) => {
  res.sendFile(resolve(clientDist, 'index.html'));
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Disclone server running on port ${PORT}`);
});
