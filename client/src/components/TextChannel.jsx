import { useState, useRef, useEffect } from 'react';

function formatTimestamp(ts) {
  return new Date(ts).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
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
      <div className="h-12 px-4 flex items-center shadow-md border-b border-black/30 flex-shrink-0">
        <span className="text-discord-muted text-xl mr-2">#</span>
        <span className="font-bold text-white">{channel.name}</span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-0.5">
        {messages.length === 0 && (
          <div className="text-center text-discord-muted mt-8">
            <p className="text-2xl mb-2">Welcome to #{channel.name}!</p>
            <p>This is the start of the channel.</p>
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
                className="pl-14 hover:bg-white/[0.02] py-0.5 group"
              >
                <span className="text-xs text-discord-muted opacity-0 group-hover:opacity-100 mr-2 select-none">
                  {formatTimestamp(msg.timestamp)}
                </span>
                <span className="text-discord-text">{msg.content}</span>
              </div>
            );
          }

          return (
            <div
              key={msg.id}
              className="flex gap-3 hover:bg-white/[0.02] py-1 mt-3 first:mt-0"
            >
              <div
                className="w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center text-white font-bold text-sm mt-0.5"
                style={{ backgroundColor: msg.avatarColor }}
              >
                {msg.username[0].toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="font-semibold text-white hover:underline cursor-pointer">
                    {msg.username}
                  </span>
                  <span className="text-xs text-discord-muted">
                    {formatTimestamp(msg.timestamp)}
                  </span>
                </div>
                <div className="text-discord-text break-words">
                  {msg.content}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="px-4 pb-6 flex-shrink-0">
        <div className="bg-discord-input rounded-lg flex items-center px-4">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={`Message #${channel.name}`}
            maxLength={2000}
            className="flex-1 bg-transparent py-3 text-discord-text outline-none placeholder:text-discord-muted"
          />
          <button
            type="submit"
            disabled={!input.trim()}
            className="text-discord-muted hover:text-discord-text disabled:opacity-30 transition-colors ml-2"
          >
            <svg
              className="w-6 h-6"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
            </svg>
          </button>
        </div>
      </form>
    </div>
  );
}
