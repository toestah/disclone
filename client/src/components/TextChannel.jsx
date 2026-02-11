import { useState, useRef, useEffect } from 'react';

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

export default function TextChannel({ channel, messages, onSendMessage }) {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!input.trim()) return;
    onSendMessage(input);
    setInput('');
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Channel header */}
      <div className="h-12 px-4 flex items-center shadow-[0_1px_0_rgba(0,0,0,0.2),0_1px_2px_rgba(0,0,0,0.1)] border-b border-black/30 flex-shrink-0 z-10 gap-2">
        <span className="text-discord-muted text-lg font-light">#</span>
        <span className="font-bold text-white text-[15px]">{channel.name}</span>
        <div className="mx-2 w-px h-5 bg-discord-muted/20" />
        <span className="text-[13px] text-discord-muted truncate">Chat with everyone in #{channel.name}</span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <div className="mt-auto flex flex-col items-start pb-4 pt-8">
            <div className="w-[68px] h-[68px] bg-discord-active rounded-full flex items-center justify-center mb-4">
              <span className="text-3xl font-light text-discord-muted">#</span>
            </div>
            <h3 className="text-[28px] font-bold text-white mb-1">Welcome to #{channel.name}!</h3>
            <p className="text-discord-muted text-sm">This is the start of the #{channel.name} channel.</p>
          </div>
        )}
        {messages.map((msg, i) => {
          const prevMsg = messages[i - 1];
          const isGrouped =
            prevMsg &&
            prevMsg.username === msg.username &&
            msg.timestamp - prevMsg.timestamp < 300000;

          if (isGrouped) {
            return (
              <div
                key={msg.id}
                className="pl-14 hover:bg-white/[0.02] py-0.5 group relative"
              >
                <span className="absolute left-0 text-[11px] text-discord-muted opacity-0 group-hover:opacity-100 w-[52px] text-right select-none top-1.5">
                  {formatShortTime(msg.timestamp)}
                </span>
                <span className="text-discord-text leading-[1.625] text-[15px]">{msg.content}</span>
              </div>
            );
          }

          return (
            <div
              key={msg.id}
              className={`flex gap-4 hover:bg-white/[0.02] py-1 rounded ${i > 0 ? 'mt-4' : ''}`}
            >
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
                <div className="text-discord-text leading-[1.625] break-words mt-0.5 text-[15px]">
                  {msg.content}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="px-4 pb-6 pt-1 flex-shrink-0">
        <div className="bg-discord-input rounded-lg flex items-center px-4 border border-transparent focus-within:border-discord-border/50 transition-colors">
          <button
            type="button"
            className="text-discord-muted hover:text-discord-text transition-colors mr-3 flex-shrink-0"
            title="Attach file"
          >
            <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm5 11h-4v4h-2v-4H7v-2h4V7h2v4h4v2z" />
            </svg>
          </button>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={`Message #${channel.name}`}
            maxLength={2000}
            className="flex-1 bg-transparent py-3 text-discord-text outline-none placeholder:text-discord-muted/50 text-[15px]"
          />
          <button
            type="submit"
            disabled={!input.trim()}
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
