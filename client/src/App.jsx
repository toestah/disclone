import { useState, useEffect, useCallback } from 'react';
import { SocketProvider, useSocket } from './hooks/useSocket.jsx';
import useVoice from './hooks/useVoice.js';
import LoginScreen from './components/LoginScreen.jsx';
import Sidebar from './components/Sidebar.jsx';
import TextChannel from './components/TextChannel.jsx';
import MemberList from './components/MemberList.jsx';

function AppContent() {
  const { socket, connected } = useSocket();
  const [user, setUser] = useState(null);
  const [loginError, setLoginError] = useState('');
  const [channels, setChannels] = useState([]);
  const [activeChannel, setActiveChannel] = useState('general');
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [voiceChannel, setVoiceChannel] = useState(null);
  const [voiceMembers, setVoiceMembers] = useState(new Map());
  const [messages, setMessages] = useState(new Map());
  const [userStatus, setUserStatusState] = useState(() => {
    const saved = localStorage.getItem('disclone_user_status');
    return saved || 'online';
  });

  // Auto-login from localStorage when socket connects
  useEffect(() => {
    if (!socket || !connected) return;

    const saved = localStorage.getItem('disclone_session');
    if (!saved) return;

    try {
      const { username, password } = JSON.parse(saved);
      if (username) {
        socket.emit('user:login', { username, password }, (response) => {
          if (response.success) {
            setUser(response.user);
            setChannels(response.channels);
            // Restore saved status
            const savedStatus = localStorage.getItem('disclone_user_status') || 'online';
            setUserStatusState(savedStatus);
            socket.emit('user:status', { status: savedStatus });
            // Load initial voice room state
            if (response.voiceState) {
              setVoiceMembers((prev) => {
                const next = new Map(prev);
                for (const [roomId, members] of Object.entries(response.voiceState)) {
                  next.set(roomId, members);
                }
                return next;
              });
            }
            socket.emit('channel:join', { channelId: 'general' }, (res) => {
              if (res?.success) {
                setMessages((prev) => {
                  const next = new Map(prev);
                  next.set('general', res.messages);
                  return next;
                });
              }
            });
          }
        });
      }
    } catch {
      /* ignore */
    }
  }, [socket, connected]);

  // Listen for server events
  useEffect(() => {
    if (!socket) return;

    const handleUsersUpdate = (users) => setOnlineUsers(users);

    const handleNewMessage = ({ channelId, message }) => {
      setMessages((prev) => {
        const next = new Map(prev);
        const existing = next.get(channelId) || [];
        next.set(channelId, [...existing, message]);
        return next;
      });
    };

    const handleVoiceRoomUpdate = ({ channelId, members }) => {
      setVoiceMembers((prev) => {
        const next = new Map(prev);
        next.set(channelId, members);
        return next;
      });
    };

    socket.on('users:update', handleUsersUpdate);
    socket.on('message:new', handleNewMessage);
    socket.on('voice:room-update', handleVoiceRoomUpdate);

    return () => {
      socket.off('users:update', handleUsersUpdate);
      socket.off('message:new', handleNewMessage);
      socket.off('voice:room-update', handleVoiceRoomUpdate);
    };
  }, [socket]);

  const handleLogin = useCallback(
    (username, password) => {
      if (!socket) return;
      setLoginError('');
      socket.emit('user:login', { username, password }, (response) => {
        if (response.success) {
          setUser(response.user);
          setChannels(response.channels);
          localStorage.setItem(
            'disclone_session',
            JSON.stringify({ username: response.user.username, password: password || null })
          );
          // Restore saved status
          const savedStatus = localStorage.getItem('disclone_user_status') || 'online';
          setUserStatusState(savedStatus);
          socket.emit('user:status', { status: savedStatus });
          // Load initial voice room state
          if (response.voiceState) {
            setVoiceMembers((prev) => {
              const next = new Map(prev);
              for (const [roomId, members] of Object.entries(response.voiceState)) {
                next.set(roomId, members);
              }
              return next;
            });
          }
          socket.emit('channel:join', { channelId: 'general' }, (res) => {
            if (res?.success) {
              setMessages((prev) => {
                const next = new Map(prev);
                next.set('general', res.messages);
                return next;
              });
            }
          });
        } else {
          setLoginError(response.error);
        }
      });
    },
    [socket]
  );

  const handleChannelSelect = useCallback(
    (channelId) => {
      if (!socket) return;
      const channel = channels.find((c) => c.id === channelId);
      if (!channel || channel.type !== 'text') return;

      setActiveChannel(channelId);
      socket.emit('channel:join', { channelId }, (response) => {
        if (response?.success) {
          setMessages((prev) => {
            const next = new Map(prev);
            next.set(channelId, response.messages);
            return next;
          });
        }
      });
    },
    [socket, channels]
  );

  const handleSendMessage = useCallback(
    (content) => {
      if (!socket) return;
      socket.emit('message:send', { channelId: activeChannel, content });
    },
    [socket, activeChannel]
  );

  const handleLogout = useCallback(() => {
    localStorage.removeItem('disclone_session');
    if (socket) {
      socket.disconnect();
    }
    setUser(null);
    setOnlineUsers([]);
    setVoiceChannel(null);
    setVoiceMembers(new Map());
    setMessages(new Map());
    setChannels([]);
    setActiveChannel('general');
    setLoginError('');
    if (socket) {
      socket.connect();
    }
  }, [socket]);

  const handleStatusChange = useCallback((status) => {
    setUserStatusState(status);
    localStorage.setItem('disclone_user_status', status);
    if (socket) {
      socket.emit('user:status', { status });
    }
  }, [socket]);

  const voiceState = useVoice(voiceChannel);

  const handleVoiceJoin = useCallback(
    (channelId) => {
      setVoiceChannel(channelId);
    },
    []
  );

  const handleVoiceLeave = useCallback(() => {
    setVoiceChannel(null);
  }, []);

  if (!user) {
    return (
      <LoginScreen
        onLogin={handleLogin}
        connected={connected}
        error={loginError}
      />
    );
  }

  const currentChannel = channels.find((c) => c.id === activeChannel);
  const voiceChannelInfo = voiceChannel
    ? channels.find((c) => c.id === voiceChannel)
    : null;

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <Sidebar
        channels={channels}
        activeChannel={activeChannel}
        voiceChannel={voiceChannel}
        voiceMembers={voiceMembers}
        onChannelSelect={handleChannelSelect}
        onVoiceJoin={handleVoiceJoin}
        onVoiceLeave={handleVoiceLeave}
        user={user}
        voiceState={voiceState}
        voiceChannelName={voiceChannelInfo?.name}
        onLogout={handleLogout}
        userStatus={userStatus}
        onStatusChange={handleStatusChange}
      />
      <main className="flex-1 flex flex-col bg-discord-chat min-w-0">
        {currentChannel?.type === 'text' && (
          <TextChannel
            channel={currentChannel}
            messages={messages.get(activeChannel) || []}
            onSendMessage={handleSendMessage}
            user={user}
          />
        )}
      </main>
      <MemberList users={onlineUsers} />
    </div>
  );
}

export default function App() {
  return (
    <SocketProvider>
      <AppContent />
    </SocketProvider>
  );
}
