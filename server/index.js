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

// Hashed assets (js/css) can be cached forever; index.html must not be cached
app.use('/assets', express.static(resolve(clientDist, 'assets'), {
  maxAge: '1y',
  immutable: true,
}));
app.use(express.static(clientDist, {
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  },
}));

// ── ICE servers endpoint (STUN + optional TURN) ─────────────────
// Configure TURN via env vars: TURN_URLS, TURN_USERNAME, TURN_CREDENTIAL
app.get('/api/ice-servers', (req, res) => {
  const iceServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];
  if (process.env.TURN_URLS) {
    const urls = process.env.TURN_URLS.split(',').map(u => u.trim());
    iceServers.push({
      urls,
      username: process.env.TURN_USERNAME || '',
      credential: process.env.TURN_CREDENTIAL || '',
    });
  }
  res.json(iceServers);
});

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
  },
  maxHttpBufferSize: 5e6, // 5MB for image attachments
});

// ── In-Memory State ──────────────────────────────────────────────

// Registered users: username -> { password, avatarColor, status, lastSeen }
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

// Muted state: socketId -> boolean
const mutedState = new Map();

// Music sharers: channelId -> { socketId, title } (one sharer per room)
const musicSharers = new Map();

// Screen sharers: channelId -> { socketId, username } (one sharer per room)
const screenSharers = new Map();

// DM channels: username -> Set<dmChannelId>
const userDMChannels = new Map();

let messageIdCounter = 0;

// ── Helpers ──────────────────────────────────────────────────────

const REACTION_EMOJI = ['👍', '👎', '😂', '❤️', '🔥', '💯'];

const AVATAR_COLORS = [
  '#5865f2', '#57f287', '#fee75c', '#eb459e',
  '#ed4245', '#f47b67', '#e78284', '#9b59b6',
  '#1abc9c', '#e67e22', '#3498db', '#e91e63',
];

function randomAvatarColor() {
  return AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
}

function parseMentions(content) {
  const mentions = [];
  const regex = /@(\w{1,20})\b/g;
  let match;
  while ((match = regex.exec(content)) !== null) mentions.push(match[1]);
  return [...new Set(mentions)];
}

function getAllUsersForBroadcast() {
  // Build a set of usernames with active sessions
  const activeByUsername = new Map();
  for (const [socketId, session] of activeSessions) {
    activeByUsername.set(session.username, { socketId, session });
  }

  const users = [];
  for (const [username, data] of registeredUsers) {
    const active = activeByUsername.get(username);
    if (active) {
      const status = data.status === 'invisible' ? 'offline' : (data.status || 'online');
      users.push({
        socketId: active.socketId,
        username,
        avatarColor: data.avatarColor,
        currentChannel: active.session.currentChannel,
        status,
      });
    } else {
      users.push({
        socketId: null,
        username,
        avatarColor: data.avatarColor,
        currentChannel: null,
        status: 'offline',
      });
    }
  }

  // Sort: online/away/busy first, offline last
  users.sort((a, b) => {
    const aOnline = a.status !== 'offline' ? 0 : 1;
    const bOnline = b.status !== 'offline' ? 0 : 1;
    return aOnline - bOnline || a.username.localeCompare(b.username);
  });

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
        muted: mutedState.get(socketId) || false,
        screenSharing: screenSharers.get(channelId)?.socketId === socketId,
      });
    }
  }
  return members;
}

// ── DM Helpers ───────────────────────────────────────────────────

function getDMChannelId(user1, user2) {
  return `dm:${[user1, user2].sort().join(':')}`;
}

function getDMParticipants(dmChannelId) {
  return dmChannelId.slice(3).split(':');
}

function getUserDMList(username) {
  const dmIds = userDMChannels.get(username);
  if (!dmIds) return [];
  const result = [];
  for (const dmId of dmIds) {
    const participants = getDMParticipants(dmId);
    const otherUser = participants.find((u) => u !== username);
    const userData = registeredUsers.get(otherUser);
    result.push({
      id: dmId,
      username: otherUser,
      avatarColor: userData?.avatarColor || '#5865f2',
    });
  }
  return result;
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
      registeredUsers.set(trimmed, { password, avatarColor, status: existing?.status || 'online', lastSeen: null });
    } else if (!existing) {
      registeredUsers.set(trimmed, { password: null, avatarColor, status: 'online', lastSeen: null });
    }

    // Create session
    activeSessions.set(socket.id, {
      username: trimmed,
      avatarColor,
      currentChannel: 'general',
    });

    socket.join('general');
    io.emit('users:update', getAllUsersForBroadcast());

    // Build current voice room state so new user sees who's in voice
    const voiceState = {};
    for (const [roomId, room] of voiceRooms) {
      if (room.size > 0) {
        voiceState[roomId] = getVoiceRoomMembers(roomId);
      }
    }

    // Auto-join all DM socket rooms
    const dmList = getUserDMList(trimmed);
    for (const dm of dmList) {
      socket.join(dm.id);
    }

    const userEntry = registeredUsers.get(trimmed);
    callback({
      success: true,
      user: { username: trimmed, avatarColor, status: userEntry?.status || 'online' },
      channels,
      voiceState,
      dmChannels: dmList,
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

    io.emit('users:update', getAllUsersForBroadcast());
  });

  socket.on('message:send', ({ channelId, content, attachments }) => {
    const session = activeSessions.get(socket.id);
    if (!session) return;

    // Validate attachments
    let validAttachments = [];
    if (Array.isArray(attachments) && attachments.length > 0) {
      if (attachments.length > 5) return; // max 5 images
      for (const att of attachments) {
        if (att.type !== 'image' || typeof att.data !== 'string') return;
        if (!att.data.startsWith('data:image/')) return;
        if (att.data.length > 2.8e6) return; // ~2.8MB base64
        validAttachments.push({ type: att.type, data: att.data });
      }
    }

    const trimmedContent = content ? content.trim() : '';
    if (!trimmedContent && validAttachments.length === 0) return;
    if (trimmedContent.length > 2000) return;

    const message = {
      id: String(++messageIdCounter),
      username: session.username,
      avatarColor: session.avatarColor,
      content: trimmedContent,
      timestamp: Date.now(),
    };
    if (validAttachments.length > 0) {
      message.attachments = validAttachments;
    }

    const history = messageHistory.get(channelId);
    if (history) {
      history.push(message);
      if (history.length > 500) history.splice(0, history.length - 500);
    }

    io.to(channelId).emit('message:new', { channelId, message });

    // Notify users not in this channel about the new message (for unread badges)
    const mentions = parseMentions(trimmedContent);
    for (const [sid, sess] of activeSessions) {
      if (sid === socket.id) continue;
      if (sess.currentChannel === channelId) continue;
      const isMentioned = mentions.includes(sess.username);
      io.to(sid).emit('message:notify', {
        channelId,
        messageId: message.id,
        senderUsername: session.username,
        isMentioned,
      });
    }
  });

  // ── Message Reactions ──

  socket.on('message:react', ({ channelId, messageId, emoji }) => {
    const session = activeSessions.get(socket.id);
    if (!session) return;
    if (!REACTION_EMOJI.includes(emoji)) return;

    const history = messageHistory.get(channelId);
    if (!history) return;

    const msg = history.find((m) => m.id === messageId);
    if (!msg) return;

    if (!msg.reactions) msg.reactions = {};
    if (!msg.reactions[emoji]) msg.reactions[emoji] = [];

    const arr = msg.reactions[emoji];
    const idx = arr.indexOf(session.username);
    if (idx !== -1) {
      arr.splice(idx, 1);
      if (arr.length === 0) delete msg.reactions[emoji];
      if (Object.keys(msg.reactions).length === 0) delete msg.reactions;
    } else {
      arr.push(session.username);
    }

    io.to(channelId).emit('message:reaction', {
      channelId,
      messageId,
      reactions: msg.reactions || {},
    });
  });

  // ── Voice Channels ──

  socket.on('voice:join', ({ channelId }, callback) => {
    const session = activeSessions.get(socket.id);
    if (!session) return;
    console.log(`[Voice] ${session.username} (${socket.id}) joining ${channelId}`);

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
    console.log(`[Voice] Notifying ${existingPeers.length} existing peer(s) about ${session.username}`);
    socket.to(`voice:${channelId}`).emit('voice:user-joined', {
      channelId,
      socketId: socket.id,
      username: session.username,
      avatarColor: session.avatarColor,
    });

    // Include active music sharer so late joiners see the jukebox
    let musicSharer = null;
    const activeSharer = musicSharers.get(channelId);
    if (activeSharer) {
      const sharerSession = activeSessions.get(activeSharer.socketId);
      if (sharerSession) {
        musicSharer = {
          socketId: activeSharer.socketId,
          username: sharerSession.username,
          title: activeSharer.title || '',
        };
      }
    }

    // Include active screen sharer so late joiners can watch
    let screenSharer = null;
    const activeScreenSharer = screenSharers.get(channelId);
    if (activeScreenSharer) {
      const sharerSession = activeSessions.get(activeScreenSharer.socketId);
      if (sharerSession) {
        screenSharer = {
          socketId: activeScreenSharer.socketId,
          username: sharerSession.username,
        };
      }
    }

    callback?.({ success: true, peers: existingPeers, musicSharer, screenSharer });

    io.emit('voice:room-update', {
      channelId,
      members: getVoiceRoomMembers(channelId),
    });
    io.emit('users:update', getAllUsersForBroadcast());
  });

  socket.on('voice:leave', ({ channelId }) => {
    const session = activeSessions.get(socket.id);
    if (!session) return;

    const room = voiceRooms.get(channelId);
    if (room) {
      // Clean up music sharing if this user was sharing
      if (musicSharers.get(channelId)?.socketId === socket.id) {
        musicSharers.delete(channelId);
        socket.to(`voice:${channelId}`).emit('music:stopped', {
          channelId,
          socketId: socket.id,
        });
      }

      // Clean up screen sharing if this user was sharing
      if (screenSharers.get(channelId)?.socketId === socket.id) {
        screenSharers.delete(channelId);
        socket.to(`voice:${channelId}`).emit('screen:stopped', {
          channelId,
          socketId: socket.id,
        });
      }

      room.delete(socket.id);
      socket.leave(`voice:${channelId}`);
      speakingState.delete(socket.id);
      mutedState.delete(socket.id);

      socket.to(`voice:${channelId}`).emit('voice:user-left', {
        channelId,
        socketId: socket.id,
      });

      io.emit('voice:room-update', {
        channelId,
        members: getVoiceRoomMembers(channelId),
      });
      io.emit('users:update', getAllUsersForBroadcast());
    }
  });

  // ── Voice Speaking / Muted State ──

  socket.on('voice:speaking', ({ channelId, speaking }) => {
    speakingState.set(socket.id, speaking);
    socket.to(`voice:${channelId}`).emit('voice:speaking', {
      socketId: socket.id,
      speaking,
    });
  });

  socket.on('voice:muted', ({ channelId, muted }) => {
    mutedState.set(socket.id, muted);
    io.emit('voice:room-update', {
      channelId,
      members: getVoiceRoomMembers(channelId),
    });
  });

  // ── WebRTC Signaling Relay ──
  // Relay offer/answer/ice-candidate between peers in the same voice room.

  function findPeerVoiceRoom(socketId) {
    for (const [roomId, room] of voiceRooms) {
      if (room.has(socketId)) return roomId;
    }
    return null;
  }

  socket.on('webrtc:offer', ({ targetId, offer }) => {
    const room = findPeerVoiceRoom(socket.id);
    if (!room) return;
    const targetRoom = findPeerVoiceRoom(targetId);
    if (room !== targetRoom) return;
    io.to(targetId).emit('webrtc:offer', { from: socket.id, offer });
  });

  socket.on('webrtc:answer', ({ targetId, answer }) => {
    const room = findPeerVoiceRoom(socket.id);
    if (!room) return;
    const targetRoom = findPeerVoiceRoom(targetId);
    if (room !== targetRoom) return;
    io.to(targetId).emit('webrtc:answer', { from: socket.id, answer });
  });

  socket.on('webrtc:ice-candidate', ({ targetId, candidate }) => {
    const room = findPeerVoiceRoom(socket.id);
    if (!room) return;
    const targetRoom = findPeerVoiceRoom(targetId);
    if (room !== targetRoom) return;
    io.to(targetId).emit('webrtc:ice-candidate', { from: socket.id, candidate });
  });

  // ── Music Sharing ──

  socket.on('music:start', ({ channelId, title }, callback) => {
    const session = activeSessions.get(socket.id);
    if (!session) return callback?.({ success: false, error: 'Not logged in' });

    const room = voiceRooms.get(channelId);
    if (!room || !room.has(socket.id)) {
      return callback?.({ success: false, error: 'Not in this voice channel' });
    }

    const existingSharer = musicSharers.get(channelId);
    if (existingSharer && existingSharer.socketId !== socket.id) {
      const sharerSession = activeSessions.get(existingSharer.socketId);
      return callback?.({ success: false, error: `${sharerSession?.username || 'Someone'} is already sharing` });
    }

    const safeTitle = typeof title === 'string' ? title.slice(0, 200) : '';
    musicSharers.set(channelId, { socketId: socket.id, title: safeTitle });
    socket.to(`voice:${channelId}`).emit('music:started', {
      channelId,
      socketId: socket.id,
      username: session.username,
      title: safeTitle,
    });
    callback?.({ success: true });
  });

  socket.on('music:stop', ({ channelId }) => {
    if (musicSharers.get(channelId)?.socketId !== socket.id) return;
    musicSharers.delete(channelId);
    socket.to(`voice:${channelId}`).emit('music:stopped', {
      channelId,
      socketId: socket.id,
    });
  });

  socket.on('music:chunk', ({ channelId, data, seq }) => {
    const room = voiceRooms.get(channelId);
    if (!room || !room.has(socket.id)) return;
    if (musicSharers.get(channelId)?.socketId !== socket.id) return;
    // Defer music relay so other event handlers get event-loop priority
    setImmediate(() => {
      socket.to(`voice:${channelId}`).volatile.emit('music:chunk', {
        from: socket.id,
        data,
        seq,
      });
    });
  });

  socket.on('music:title', ({ channelId, title }) => {
    const sharer = musicSharers.get(channelId);
    if (!sharer || sharer.socketId !== socket.id) return;
    const safeTitle = typeof title === 'string' ? title.slice(0, 200) : '';
    sharer.title = safeTitle;
    socket.to(`voice:${channelId}`).emit('music:title', {
      channelId,
      title: safeTitle,
    });
  });

  // ── Screen Sharing ──

  socket.on('screen:start', ({ channelId }, callback) => {
    const session = activeSessions.get(socket.id);
    if (!session) return callback?.({ success: false, error: 'Not logged in' });

    const room = voiceRooms.get(channelId);
    if (!room || !room.has(socket.id)) {
      return callback?.({ success: false, error: 'Not in this voice channel' });
    }

    const existingSharer = screenSharers.get(channelId);
    if (existingSharer && existingSharer.socketId !== socket.id) {
      const sharerSession = activeSessions.get(existingSharer.socketId);
      return callback?.({ success: false, error: `${sharerSession?.username || 'Someone'} is already sharing their screen` });
    }

    screenSharers.set(channelId, { socketId: socket.id, username: session.username });
    socket.to(`voice:${channelId}`).emit('screen:started', {
      channelId,
      socketId: socket.id,
      username: session.username,
    });
    callback?.({ success: true });

    io.emit('voice:room-update', {
      channelId,
      members: getVoiceRoomMembers(channelId),
    });
  });

  socket.on('screen:stop', ({ channelId }) => {
    if (screenSharers.get(channelId)?.socketId !== socket.id) return;
    screenSharers.delete(channelId);
    socket.to(`voice:${channelId}`).emit('screen:stopped', {
      channelId,
      socketId: socket.id,
    });

    io.emit('voice:room-update', {
      channelId,
      members: getVoiceRoomMembers(channelId),
    });
  });

  socket.on('screen:watch', ({ sharerSocketId }) => {
    const room = findPeerVoiceRoom(socket.id);
    if (!room) return;
    const sharerRoom = findPeerVoiceRoom(sharerSocketId);
    if (room !== sharerRoom) return;
    if (screenSharers.get(room)?.socketId !== sharerSocketId) return;
    io.to(sharerSocketId).emit('screen:viewer-ready', {
      viewerSocketId: socket.id,
    });
  });

  socket.on('screen:offer', ({ targetId, offer }) => {
    const room = findPeerVoiceRoom(socket.id);
    if (!room) return;
    const targetRoom = findPeerVoiceRoom(targetId);
    if (room !== targetRoom) return;
    io.to(targetId).emit('screen:offer', { from: socket.id, offer });
  });

  socket.on('screen:answer', ({ targetId, answer }) => {
    const room = findPeerVoiceRoom(socket.id);
    if (!room) return;
    const targetRoom = findPeerVoiceRoom(targetId);
    if (room !== targetRoom) return;
    io.to(targetId).emit('screen:answer', { from: socket.id, answer });
  });

  socket.on('screen:ice-candidate', ({ targetId, candidate }) => {
    const room = findPeerVoiceRoom(socket.id);
    if (!room) return;
    const targetRoom = findPeerVoiceRoom(targetId);
    if (room !== targetRoom) return;
    io.to(targetId).emit('screen:ice-candidate', { from: socket.id, candidate });
  });

  // ── Direct Messages ──

  socket.on('dm:open', ({ targetUsername }, callback) => {
    const session = activeSessions.get(socket.id);
    if (!session) return callback?.({ success: false, error: 'Not logged in' });
    if (targetUsername === session.username) return callback?.({ success: false, error: 'Cannot DM yourself' });
    if (!registeredUsers.has(targetUsername)) return callback?.({ success: false, error: 'User not found' });

    const dmChannelId = getDMChannelId(session.username, targetUsername);

    // Initialize message history if new
    if (!messageHistory.has(dmChannelId)) {
      messageHistory.set(dmChannelId, []);
    }

    // Add to both users' DM lists
    if (!userDMChannels.has(session.username)) userDMChannels.set(session.username, new Set());
    if (!userDMChannels.has(targetUsername)) userDMChannels.set(targetUsername, new Set());
    userDMChannels.get(session.username).add(dmChannelId);
    userDMChannels.get(targetUsername).add(dmChannelId);

    // Join socket room
    socket.join(dmChannelId);

    // Also join target's socket if they're online
    for (const [sid, sess] of activeSessions) {
      if (sess.username === targetUsername) {
        io.sockets.sockets.get(sid)?.join(dmChannelId);
        // Notify target about the new DM
        io.to(sid).emit('dm:opened', {
          id: dmChannelId,
          username: session.username,
          avatarColor: session.avatarColor,
        });
      }
    }

    const history = messageHistory.get(dmChannelId) || [];
    const targetData = registeredUsers.get(targetUsername);
    callback?.({
      success: true,
      dmChannel: {
        id: dmChannelId,
        username: targetUsername,
        avatarColor: targetData?.avatarColor || '#5865f2',
      },
      messages: history.slice(-100),
    });
  });

  socket.on('dm:send', ({ dmChannelId, content, attachments }) => {
    const session = activeSessions.get(socket.id);
    if (!session) return;

    // Validate sender is a participant
    const participants = getDMParticipants(dmChannelId);
    if (!participants.includes(session.username)) return;

    // Validate attachments
    let validAttachments = [];
    if (Array.isArray(attachments) && attachments.length > 0) {
      if (attachments.length > 5) return;
      for (const att of attachments) {
        if (att.type !== 'image' || typeof att.data !== 'string') return;
        if (!att.data.startsWith('data:image/')) return;
        if (att.data.length > 2.8e6) return;
        validAttachments.push({ type: att.type, data: att.data });
      }
    }

    const trimmedContent = content ? content.trim() : '';
    if (!trimmedContent && validAttachments.length === 0) return;
    if (trimmedContent.length > 2000) return;

    const message = {
      id: String(++messageIdCounter),
      username: session.username,
      avatarColor: session.avatarColor,
      content: trimmedContent,
      timestamp: Date.now(),
    };
    if (validAttachments.length > 0) {
      message.attachments = validAttachments;
    }

    if (!messageHistory.has(dmChannelId)) {
      messageHistory.set(dmChannelId, []);
    }
    const history = messageHistory.get(dmChannelId);
    history.push(message);
    if (history.length > 500) history.splice(0, history.length - 500);

    io.to(dmChannelId).emit('dm:new', { dmChannelId, message });
  });

  socket.on('dm:join', ({ dmChannelId }, callback) => {
    const session = activeSessions.get(socket.id);
    if (!session) return callback?.({ success: false });

    const participants = getDMParticipants(dmChannelId);
    if (!participants.includes(session.username)) return callback?.({ success: false });

    socket.join(dmChannelId);
    const history = messageHistory.get(dmChannelId) || [];
    callback?.({ success: true, messages: history.slice(-100) });
  });

  // ── User Status ──

  socket.on('user:status', ({ status }) => {
    const session = activeSessions.get(socket.id);
    if (!session) return;
    const validStatuses = ['online', 'away', 'busy', 'invisible'];
    if (!validStatuses.includes(status)) return;
    const userEntry = registeredUsers.get(session.username);
    if (userEntry) {
      userEntry.status = status;
    }
    io.emit('users:update', getAllUsersForBroadcast());
  });

  // ── Disconnect ──

  socket.on('disconnect', () => {
    const session = activeSessions.get(socket.id);
    if (!session) return;

    console.log(`Disconnected: ${socket.id} (${session.username})`);

    // Update lastSeen on registered user
    const userEntry = registeredUsers.get(session.username);
    if (userEntry) {
      userEntry.lastSeen = Date.now();
    }

    for (const [roomId, room] of voiceRooms) {
      if (room.has(socket.id)) {
        // Clean up music sharing if this user was sharing
        if (musicSharers.get(roomId)?.socketId === socket.id) {
          musicSharers.delete(roomId);
          socket.to(`voice:${roomId}`).emit('music:stopped', {
            channelId: roomId,
            socketId: socket.id,
          });
        }

        // Clean up screen sharing if this user was sharing
        if (screenSharers.get(roomId)?.socketId === socket.id) {
          screenSharers.delete(roomId);
          socket.to(`voice:${roomId}`).emit('screen:stopped', {
            channelId: roomId,
            socketId: socket.id,
          });
        }

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
    mutedState.delete(socket.id);
    activeSessions.delete(socket.id);
    io.emit('users:update', getAllUsersForBroadcast());
  });
});

// ── Start Server ─────────────────────────────────────────────────

// SPA fallback — serve index.html for any non-API/non-static route
app.get('*', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(resolve(clientDist, 'index.html'));
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Disclone server running on port ${PORT}`);
});
