import { useRef, useEffect, useState } from 'react';

export default function ScreenViewer({ screenStream, screenSharer, onStopWatching }) {
  const videoRef = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (video && screenStream) {
      video.srcObject = screenStream;
    }
    return () => {
      if (video) {
        video.srcObject = null;
      }
    };
  }, [screenStream]);

  useEffect(() => {
    function handleFullscreenChange() {
      setIsFullscreen(!!document.fullscreenElement);
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else if (videoRef.current) {
      videoRef.current.requestFullscreen().catch(() => {});
    }
  };

  return (
    <div className="absolute inset-0 z-20 bg-black/95 flex flex-col">
      {/* Header bar */}
      <div className="flex items-center gap-3 px-4 py-2 bg-black/60 flex-shrink-0">
        <svg className="w-4 h-4 text-discord-green flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
          <path d="M21 3H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h5v2h8v-2h5c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 14H3V5h18v12z" />
        </svg>
        <span className="text-white text-sm font-medium truncate">
          {screenSharer?.username || 'Someone'} is sharing their screen
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={toggleFullscreen}
            className="p-1.5 rounded text-discord-muted hover:text-white hover:bg-white/10 transition-colors"
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
              {isFullscreen ? (
                <path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z" />
              ) : (
                <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" />
              )}
            </svg>
          </button>
          <button
            onClick={onStopWatching}
            className="px-3 py-1 rounded text-sm font-medium bg-discord-red/80 text-white hover:bg-discord-red transition-colors"
          >
            Stop Watching
          </button>
        </div>
      </div>

      {/* Video */}
      <div className="flex-1 flex items-center justify-center min-h-0">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          className="max-w-full max-h-full object-contain"
        />
      </div>
    </div>
  );
}
