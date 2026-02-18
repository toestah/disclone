import { useState, useRef, useEffect, useCallback } from 'react';

function formatTimestamp(ts) {
  const date = new Date(ts);
  const today = new Date();
  const isToday = date.toDateString() === today.toDateString();
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return isToday ? `Today at ${time}` : `${date.toLocaleDateString([], { month: '2-digit', day: '2-digit', year: '2-digit' })} ${time}`;
}

function formatShortTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function extractYouTubeId(url) {
  const m = /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/.exec(url);
  return m ? m[1] : null;
}

// URL regex for linkification
const URL_REGEX = /(https?:\/\/[^\s<]+)/g;

function YouTubeEmbed({ videoId }) {
  const [playing, setPlaying] = useState(false);
  if (playing) {
    return (
      <div className="mt-2 rounded-lg overflow-hidden max-w-[400px] border border-white/10">
        <iframe
          width="400"
          height="225"
          src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1`}
          allow="autoplay; encrypted-media"
          allowFullScreen
          className="block"
        />
      </div>
    );
  }
  return (
    <div
      className="mt-2 rounded-lg overflow-hidden max-w-[400px] relative cursor-pointer group border border-white/10"
      onClick={() => setPlaying(true)}
    >
      <img
        src={`https://img.youtube.com/vi/${videoId}/mqdefault.jpg`}
        alt="YouTube thumbnail"
        className="w-full block"
      />
      <div className="absolute inset-0 flex items-center justify-center bg-black/30 group-hover:bg-black/40 transition-colors">
        <div className="w-14 h-10 bg-red-600 rounded-xl flex items-center justify-center group-hover:bg-red-500 transition-colors">
          <svg className="w-5 h-5 text-white ml-0.5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
        </div>
      </div>
    </div>
  );
}

function MessageContent({ content }) {
  if (!content) return null;

  // Split content by URLs, linkify them, and detect YouTube
  const parts = [];
  const youtubeIds = new Set();
  let lastIndex = 0;

  for (const match of content.matchAll(URL_REGEX)) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', value: content.slice(lastIndex, match.index) });
    }
    const url = match[0];
    parts.push({ type: 'link', value: url });
    const ytId = extractYouTubeId(url);
    if (ytId) youtubeIds.add(ytId);
    lastIndex = match.index + url.length;
  }
  if (lastIndex < content.length) {
    parts.push({ type: 'text', value: content.slice(lastIndex) });
  }

  return (
    <>
      <div className="text-discord-text leading-[1.625] break-words mt-0.5 text-[15px]">
        {parts.length === 0
          ? content
          : parts.map((p, i) =>
              p.type === 'link' ? (
                <a
                  key={i}
                  href={p.value}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-discord-link hover:underline"
                >
                  {p.value}
                </a>
              ) : (
                <span key={i}>{p.value}</span>
              )
            )}
      </div>
      {[...youtubeIds].map((id) => (
        <YouTubeEmbed key={id} videoId={id} />
      ))}
    </>
  );
}

function MessageAttachments({ attachments }) {
  if (!attachments || attachments.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 mt-1.5">
      {attachments.map((att, i) => (
        <a key={i} href={att.data} target="_blank" rel="noopener noreferrer">
          <img
            src={att.data}
            alt="attachment"
            className="max-w-[400px] max-h-[300px] rounded-lg border border-white/10 object-contain cursor-pointer hover:opacity-90 transition-opacity"
          />
        </a>
      ))}
    </div>
  );
}

const REACTION_EMOJI = ['👍', '👎', '😂', '❤️', '🔥', '💯'];

function ReactionPicker({ onSelect }) {
  return (
    <div className="flex items-center bg-discord-sidebar border border-white/10 rounded-md shadow-lg">
      {REACTION_EMOJI.map((emoji) => (
        <button
          key={emoji}
          onClick={(e) => { e.stopPropagation(); onSelect(emoji); }}
          className="w-8 h-8 flex items-center justify-center hover:bg-white/10 text-base transition-colors first:rounded-l-md last:rounded-r-md"
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}

function ReactionPills({ reactions, currentUser, onToggle }) {
  if (!reactions || Object.keys(reactions).length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {Object.entries(reactions).map(([emoji, users]) => {
        const reacted = users.includes(currentUser);
        return (
          <button
            key={emoji}
            onClick={(e) => { e.stopPropagation(); onToggle(emoji); }}
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-xs border transition-colors ${
              reacted
                ? 'bg-discord-accent/20 border-discord-accent/50 text-discord-accent'
                : 'bg-white/5 border-white/10 text-discord-muted hover:border-white/20'
            }`}
          >
            <span className="text-sm leading-none">{emoji}</span>
            <span>{users.length}</span>
          </button>
        );
      })}
    </div>
  );
}

export default function TextChannel({ channel, messages, onSendMessage, onReact, currentUser, isDM, dmTarget }) {
  const [input, setInput] = useState('');
  const [pendingImages, setPendingImages] = useState([]);
  const [hoveredMsgId, setHoveredMsgId] = useState(null);
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const seenIdsRef = useRef(new Set());

  // On mount (channel switch via key=), snapshot current message IDs so history doesn't animate
  useEffect(() => {
    const ids = new Set();
    for (const msg of messages) ids.add(msg.id);
    seenIdsRef.current = ids;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const addImages = useCallback((files) => {
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      if (file.size > 2 * 1024 * 1024) continue; // 2MB raw file limit
      const reader = new FileReader();
      reader.onload = (e) => {
        setPendingImages((prev) => {
          if (prev.length >= 5) return prev;
          return [...prev, { data: e.target.result, name: file.name }];
        });
      };
      reader.readAsDataURL(file);
    }
  }, []);

  const handlePaste = useCallback((e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageFiles = [];
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    if (imageFiles.length > 0) {
      e.preventDefault();
      addImages(imageFiles);
    }
  }, [addImages]);

  const handleSubmit = (e) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed && pendingImages.length === 0) return;

    const attachments = pendingImages.map((img) => ({ type: 'image', data: img.data }));
    onSendMessage(trimmed, attachments.length > 0 ? attachments : undefined);
    setInput('');
    setPendingImages([]);
  };

  const removePendingImage = (index) => {
    setPendingImages((prev) => prev.filter((_, i) => i !== index));
  };

  const headerIcon = isDM ? '@' : '#';
  const headerName = isDM ? dmTarget : channel.name;
  const headerDesc = isDM
    ? `Direct message with ${dmTarget}`
    : `Chat with everyone in #${channel.name}`;
  const placeholder = isDM ? `Message @${dmTarget}` : `Message #${channel.name}`;

  return (
    <div className="flex flex-col flex-1 min-h-0 channel-transition">
      {/* Channel header */}
      <div className="h-12 px-4 flex items-center shadow-[0_1px_0_rgba(0,0,0,0.2),0_1px_2px_rgba(0,0,0,0.1)] border-b border-black/30 flex-shrink-0 z-10 gap-2">
        <span className="text-discord-muted text-lg font-light">{headerIcon}</span>
        <span className="font-bold text-white text-[15px]">{headerName}</span>
        <div className="mx-2 w-px h-5 bg-discord-muted/20 hidden sm:block" />
        <span className="text-[13px] text-discord-muted truncate hidden sm:block">{headerDesc}</span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <div className="mt-auto flex flex-col items-start pb-4 pt-8">
            {isDM ? (
              <>
                <div className="w-[68px] h-[68px] bg-discord-active rounded-full flex items-center justify-center mb-4">
                  <span className="text-3xl font-light text-discord-muted">@</span>
                </div>
                <h3 className="text-[28px] font-bold text-white mb-1">{dmTarget}</h3>
                <p className="text-discord-muted text-sm">This is the beginning of your direct message history with {dmTarget}.</p>
              </>
            ) : (
              <>
                <div className="w-[68px] h-[68px] bg-discord-active rounded-full flex items-center justify-center mb-4">
                  <span className="text-3xl font-light text-discord-muted">#</span>
                </div>
                <h3 className="text-[28px] font-bold text-white mb-1">Welcome to #{channel.name}!</h3>
                <p className="text-discord-muted text-sm">This is the start of the #{channel.name} channel.</p>
              </>
            )}
          </div>
        )}
        {messages.map((msg, i) => {
          const prevMsg = messages[i - 1];
          const isGrouped =
            prevMsg &&
            prevMsg.username === msg.username &&
            msg.timestamp - prevMsg.timestamp < 300000;
          const isNew = !seenIdsRef.current.has(msg.id);
          if (isNew) seenIdsRef.current.add(msg.id);
          const animClass = isNew ? ' message-appear' : '';

          const reactTo = (emoji) => onReact?.(channel.id, msg.id, emoji);

          if (isGrouped) {
            return (
              <div
                key={msg.id}
                className={`pl-14 hover:bg-white/[0.02] py-0.5 group relative${animClass}`}
                onMouseEnter={() => setHoveredMsgId(msg.id)}
                onMouseLeave={() => setHoveredMsgId(null)}
              >
                <span className="absolute left-0 text-[11px] text-discord-muted opacity-0 group-hover:opacity-100 w-[52px] text-right select-none top-1.5">
                  {formatShortTime(msg.timestamp)}
                </span>
                {hoveredMsgId === msg.id && (
                  <div className="absolute -top-3 right-2 z-10">
                    <ReactionPicker onSelect={reactTo} />
                  </div>
                )}
                <MessageContent content={msg.content} />
                <MessageAttachments attachments={msg.attachments} />
                <ReactionPills reactions={msg.reactions} currentUser={currentUser} onToggle={reactTo} />
              </div>
            );
          }

          return (
            <div
              key={msg.id}
              className={`flex gap-4 hover:bg-white/[0.02] py-1 rounded relative ${i > 0 ? 'mt-4' : ''}${animClass}`}
              onMouseEnter={() => setHoveredMsgId(msg.id)}
              onMouseLeave={() => setHoveredMsgId(null)}
            >
              {hoveredMsgId === msg.id && (
                <div className="absolute -top-3 right-2 z-10">
                  <ReactionPicker onSelect={reactTo} />
                </div>
              )}
              <div
                className="w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center text-white font-semibold text-sm mt-1 cursor-pointer hover:opacity-90 transition-opacity"
                style={{ backgroundColor: msg.avatarColor }}
              >
                {msg.username[0].toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="font-semibold text-white hover:underline cursor-pointer leading-snug">
                    {msg.username}
                  </span>
                  <span className="text-[11px] text-discord-muted">
                    {formatTimestamp(msg.timestamp)}
                  </span>
                </div>
                <MessageContent content={msg.content} />
                <MessageAttachments attachments={msg.attachments} />
                <ReactionPills reactions={msg.reactions} currentUser={currentUser} onToggle={reactTo} />
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Pending images preview */}
      {pendingImages.length > 0 && (
        <div className="px-4 pt-2 flex-shrink-0">
          <div className="bg-discord-input rounded-t-lg border border-b-0 border-white/10 px-3 py-2 flex gap-2 flex-wrap">
            {pendingImages.map((img, i) => (
              <div key={i} className="relative group">
                <img
                  src={img.data}
                  alt={img.name}
                  className="w-20 h-20 object-cover rounded-md border border-white/10"
                />
                <button
                  onClick={() => removePendingImage(i)}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-discord-red rounded-full flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <form onSubmit={handleSubmit} className={`px-4 pb-6 max-sm:pb-20 ${pendingImages.length > 0 ? 'pt-0' : 'pt-1'} flex-shrink-0`}>
        <div className={`bg-discord-input flex items-center px-4 border border-transparent focus-within:border-discord-border/50 transition-colors ${pendingImages.length > 0 ? 'rounded-b-lg border-t border-white/10' : 'rounded-lg'}`}>
          <button
            type="button"
            className="text-discord-muted hover:text-discord-text transition-colors mr-3 flex-shrink-0"
            title="Attach image"
            onClick={() => fileInputRef.current?.click()}
          >
            <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm5 11h-4v4h-2v-4H7v-2h4V7h2v4h4v2z" />
            </svg>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) addImages([...e.target.files]);
              e.target.value = '';
            }}
          />
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={handlePaste}
            placeholder={placeholder}
            maxLength={2000}
            className="flex-1 bg-transparent py-3 text-discord-text outline-none placeholder:text-discord-muted/50 text-[15px]"
          />
          <button
            type="submit"
            disabled={!input.trim() && pendingImages.length === 0}
            className="text-discord-muted hover:text-discord-text disabled:opacity-20 disabled:hover:text-discord-muted transition-colors ml-3 flex-shrink-0"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
            </svg>
          </button>
        </div>
      </form>
    </div>
  );
}
