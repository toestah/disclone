import { useState, useEffect, useCallback, useRef } from 'react';
import { SocketProvider, useSocket } from './hooks/useSocket.jsx';
import useVoice from './hooks/useVoice.js';
import useSounds from './hooks/useSounds.js';
import LoginScreen from './components/LoginScreen.jsx';
import Sidebar from './components/Sidebar.jsx';
import TextChannel from './components/TextChannel.jsx';
import MemberList from './components/MemberList.jsx';
import MobileTabBar from './components/MobileTabBar.jsx';
import MobileVoiceView from './components/MobileVoiceView.jsx';
import MobileProfileView from './components/MobileProfileView.jsx';
import ScreenViewer from './components/ScreenViewer.jsx';

function AppContent() {
  const { socket, connected } = useSocket();
  const sounds = useSounds();
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

  // Voice reconnect refs
  const voiceChannelRef = useRef(null);
  const isReconnectRef = useRef(false);
  useEffect(() => { voiceChannelRef.current = voiceChannel; }, [voiceChannel]);

  // DM state
  const [dmChannels, setDmChannels] = useState([]);
  const [activeDM, setActiveDM] = useState(null); // null = text channel, dmChannelId = DM view

  // Mobile tab state
  const [mobileTab, setMobileTab] = useState('chat');

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
            if (response.dmChannels) setDmChannels(response.dmChannels);
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
            // Auto-rejoin voice channel on reconnect
            if (isReconnectRef.current && voiceChannelRef.current) {
              const savedVC = voiceChannelRef.current;
              setVoiceChannel(null);
              setTimeout(() => setVoiceChannel(savedVC), 200);
            }
            isReconnectRef.current = true;
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

    const handleDMNew = ({ dmChannelId, message }) => {
      setMessages((prev) => {
        const next = new Map(prev);
        const existing = next.get(dmChannelId) || [];
        next.set(dmChannelId, [...existing, message]);
        return next;
      });
    };

    const handleReaction = ({ channelId, messageId, reactions }) => {
      setMessages((prev) => {
        const next = new Map(prev);
        const msgs = next.get(channelId);
        if (!msgs) return prev;
        next.set(
          channelId,
          msgs.map((m) =>
            m.id === messageId ? { ...m, reactions: Object.keys(reactions).length > 0 ? reactions : undefined } : m
          )
        );
        return next;
      });
    };

    const handleDMOpened = (dmChannel) => {
      setDmChannels((prev) => {
        if (prev.some((d) => d.id === dmChannel.id)) return prev;
        return [...prev, dmChannel];
      });
    };

    socket.on('users:update', handleUsersUpdate);
    socket.on('message:new', handleNewMessage);
    socket.on('message:reaction', handleReaction);
    socket.on('voice:room-update', handleVoiceRoomUpdate);
    socket.on('dm:new', handleDMNew);
    socket.on('dm:opened', handleDMOpened);

    return () => {
      socket.off('users:update', handleUsersUpdate);
      socket.off('message:new', handleNewMessage);
      socket.off('message:reaction', handleReaction);
      socket.off('voice:room-update', handleVoiceRoomUpdate);
      socket.off('dm:new', handleDMNew);
      socket.off('dm:opened', handleDMOpened);
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
          if (response.dmChannels) setDmChannels(response.dmChannels);
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

      setActiveDM(null); // clear DM view
      setActiveChannel(channelId);
      setMobileTab('chat');
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
    (content, attachments) => {
      if (!socket) return;
      socket.emit('message:send', { channelId: activeChannel, content, attachments });
      sounds.play('messageSend');
    },
    [socket, activeChannel, sounds]
  );

  // ── DM Handlers ──

  const handleOpenDM = useCallback(
    (targetUsername) => {
      if (!socket) return;
      socket.emit('dm:open', { targetUsername }, (response) => {
        if (response?.success) {
          const { dmChannel, messages: dmMessages } = response;
          // Add to DM list if not already there
          setDmChannels((prev) => {
            if (prev.some((d) => d.id === dmChannel.id)) return prev;
            return [...prev, dmChannel];
          });
          // Store messages
          setMessages((prev) => {
            const next = new Map(prev);
            next.set(dmChannel.id, dmMessages);
            return next;
          });
          setActiveDM(dmChannel.id);
        }
      });
    },
    [socket]
  );

  const handleDMSelect = useCallback(
    (dmChannelId) => {
      if (!socket) return;
      setActiveDM(dmChannelId);
      setMobileTab('chat');
      // Fetch latest messages
      socket.emit('dm:join', { dmChannelId }, (response) => {
        if (response?.success) {
          setMessages((prev) => {
            const next = new Map(prev);
            next.set(dmChannelId, response.messages);
            return next;
          });
        }
      });
    },
    [socket]
  );

  const handleSendDM = useCallback(
    (content, attachments) => {
      if (!socket || !activeDM) return;
      socket.emit('dm:send', { dmChannelId: activeDM, content, attachments });
      sounds.play('messageSend');
    },
    [socket, activeDM, sounds]
  );

  const handleReact = useCallback(
    (channelId, messageId, emoji) => {
      if (!socket) return;
      socket.emit('message:react', { channelId, messageId, emoji });
    },
    [socket]
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
    setActiveDM(null);
    setDmChannels([]);
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

  const voiceState = useVoice(voiceChannel, sounds.play);

  // Auto-reset: if voice disconnects while on voice tab, switch to chat
  const effectiveMobileTab = (!voiceChannel && mobileTab === 'voice') ? 'chat' : mobileTab;

  const handleVoiceJoin = useCallback(
    (channelId) => {
      setVoiceChannel(channelId);
      setMobileTab('voice');
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

  // Find DM target username for header
  const activeDMInfo = activeDM ? dmChannels.find((d) => d.id === activeDM) : null;

  const memberListProps = {
    user,
    userStatus,
    onStatusChange: handleStatusChange,
    onLogout: handleLogout,
    voiceState,
    voiceChannel,
    sounds,
  };

  return (
    <div className="flex h-screen w-screen overflow-clip noise-texture">
      {/* Sidebar — desktop: fixed 240px column, mobile: full-screen when channels tab */}
      <div className={`max-sm:fixed max-sm:inset-0 max-sm:z-40 sm:w-60 sm:flex-shrink-0 ${effectiveMobileTab === 'channels' ? 'max-sm:block' : 'max-sm:hidden'}`}>
        <Sidebar
          channels={channels}
          activeChannel={activeDM ? null : activeChannel}
          voiceChannel={voiceChannel}
          voiceMembers={voiceMembers}
          onChannelSelect={handleChannelSelect}
          onVoiceJoin={handleVoiceJoin}
          onVoiceLeave={handleVoiceLeave}
          user={user}
          voiceState={voiceState}
          voiceChannelName={voiceChannelInfo?.name}
          dmChannels={dmChannels}
          activeDM={activeDM}
          onDMSelect={handleDMSelect}
        />
      </div>

      {/* Main chat — desktop: flex column, mobile: full-screen when chat tab */}
      <main className={`flex-1 flex flex-col bg-discord-chat min-w-0 max-sm:fixed max-sm:inset-0 max-sm:z-30 ambient-bg ambient-bg-chat relative ${effectiveMobileTab !== 'chat' ? 'max-sm:hidden' : ''}`}>
        {/* Screen share notification bar */}
        {voiceState.screenSharer && !voiceState.isScreenSharing && !voiceState.screenStream && (
          <div className="flex items-center gap-3 px-4 py-2 bg-discord-brand/90 text-white text-sm flex-shrink-0">
            <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
              <path d="M21 3H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h5v2h8v-2h5c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 14H3V5h18v12z" />
            </svg>
            <span className="truncate">{voiceState.screenSharer.username} is sharing their screen</span>
            <button
              onClick={() => voiceState.watchScreen(voiceState.screenSharer.socketId)}
              className="ml-auto px-3 py-1 rounded text-sm font-medium bg-white/20 hover:bg-white/30 transition-colors flex-shrink-0"
            >
              Watch Stream
            </button>
          </div>
        )}

        {activeDM && activeDMInfo ? (
          <TextChannel
            key={activeDM}
            channel={{ id: activeDM, name: activeDMInfo.username }}
            messages={messages.get(activeDM) || []}
            onSendMessage={handleSendDM}
            onReact={handleReact}
            currentUser={user.username}
            isDM
            dmTarget={activeDMInfo.username}
          />
        ) : (
          currentChannel?.type === 'text' && (
            <TextChannel
              key={activeChannel}
              channel={currentChannel}
              messages={messages.get(activeChannel) || []}
              onSendMessage={handleSendMessage}
              onReact={handleReact}
              currentUser={user.username}
            />
          )
        )}

        {/* Screen viewer overlay */}
        {voiceState.screenStream && (
          <ScreenViewer
            screenStream={voiceState.screenStream}
            screenSharer={voiceState.screenSharer}
            onStopWatching={voiceState.stopWatching}
          />
        )}
      </main>

      {/* Mobile voice view — only when voice tab active */}
      {voiceChannel && (
        <div className={`fixed inset-0 z-30 sm:hidden ${effectiveMobileTab === 'voice' ? 'block' : 'hidden'}`}>
          <MobileVoiceView
            voiceChannel={voiceChannel}
            voiceChannelName={voiceChannelInfo?.name}
            voiceMembers={voiceMembers}
            voiceState={voiceState}
            user={user}
            onVoiceLeave={handleVoiceLeave}
          />
        </div>
      )}

      {/* Mobile profile view — only when me tab active */}
      <div className={`fixed inset-0 z-30 sm:hidden ${effectiveMobileTab === 'me' ? 'block' : 'hidden'}`}>
        <MobileProfileView
          user={user}
          userStatus={userStatus}
          onStatusChange={handleStatusChange}
          onLogout={handleLogout}
          voiceState={voiceState}
          voiceChannel={voiceChannel}
          sounds={sounds}
        />
      </div>

      {/* MemberList — desktop: side column (hidden <lg), mobile: full-screen when members tab */}
      <div className={`flex-shrink-0 max-sm:fixed max-sm:inset-0 max-sm:z-30 sm:w-32 lg:w-60 sm:transition-[width] sm:duration-300 sm:ease-in-out ambient-bg${voiceChannel ? ' ambient-bg-members-voice' : ' ambient-bg-members'} ${effectiveMobileTab !== 'members' ? 'max-sm:hidden' : ''}`}>
        <MemberList
          users={onlineUsers}
          currentUser={user.username}
          onOpenDM={handleOpenDM}
          {...memberListProps}
        />
      </div>

      {/* Mobile tab bar */}
      <MobileTabBar
        activeTab={effectiveMobileTab}
        onTabChange={setMobileTab}
        hasVoice={!!voiceChannel}
      />
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
