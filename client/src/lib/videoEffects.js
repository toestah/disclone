// Video background effects — blur, virtual backgrounds, and CSS filters
// Uses @mediapipe/tasks-vision for selfie segmentation (lazy-loaded)
// CSS canvas filters (grayscale, sepia, etc.) need no ML

// ── MediaPipe singleton loader ──────────────────────────────────

let segmenterPromise = null;

async function loadMediaPipe() {
  if (segmenterPromise) return segmenterPromise;
  segmenterPromise = (async () => {
    const { ImageSegmenter, FilesetResolver } = await import('@mediapipe/tasks-vision');
    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
    );
    let segmenter;
    try {
      segmenter = await ImageSegmenter.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite',
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        outputCategoryMask: false,
        outputConfidenceMasks: true,
      });
    } catch {
      // GPU delegate failed — fallback to CPU
      segmenter = await ImageSegmenter.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite',
          delegate: 'CPU',
        },
        runningMode: 'VIDEO',
        outputCategoryMask: false,
        outputConfidenceMasks: true,
      });
    }
    return segmenter;
  })();
  segmenterPromise.catch(() => { segmenterPromise = null; });
  return segmenterPromise;
}

// ── Effect presets ──────────────────────────────────────────────

export const EFFECT_PRESETS = {
  none:            { type: 'none',   label: 'None' },
  // CSS canvas filters (no ML)
  grayscale:       { type: 'filter', label: 'Grayscale', filter: 'grayscale(100%)' },
  sepia:           { type: 'filter', label: 'Sepia',     filter: 'sepia(80%)' },
  warm:            { type: 'filter', label: 'Warm',      filter: 'sepia(30%) saturate(140%) brightness(105%)' },
  cool:            { type: 'filter', label: 'Cool',      filter: 'saturate(80%) hue-rotate(15deg) brightness(105%)' },
  // Background blur (ML)
  blur:            { type: 'blur',   label: 'Blur BG',   blurAmount: 10 },
  // Virtual backgrounds (ML)
  solid_dark:      { type: 'bg',     label: 'Dark',      bg: '#1e1f22' },
  solid_white:     { type: 'bg',     label: 'White',     bg: '#ffffff' },
  gradient_ocean:  { type: 'bg',     label: 'Ocean',     gradient: ['#0f2027', '#203a43', '#2c5364'] },
  gradient_sunset: { type: 'bg',     label: 'Sunset',    gradient: ['#ee9ca7', '#ffdde1', '#f8b500'] },
  gradient_forest: { type: 'bg',     label: 'Forest',    gradient: ['#134e5e', '#71b280', '#2d6a3f'] },
};

// ── VideoEffectsProcessor ──────────────────────────────────────

export class VideoEffectsProcessor {
  constructor() {
    this._effect = EFFECT_PRESETS.none;
    this._video = null;
    this._canvas = null;
    this._ctx = null;
    this._tempCanvas = null;
    this._tempCtx = null;
    this._rafId = null;
    this._rawStream = null;
    this._processedStream = null;
    this._segmenter = null;
    this._running = false;
    this._lastFrameTime = 0;
  }

  /**
   * Start processing the raw camera stream.
   * Returns the stream to send to peers (raw if effect=none, canvas stream otherwise).
   */
  async start(rawStream) {
    this._rawStream = rawStream;
    if (this._effect.type === 'none') {
      return rawStream;
    }
    return this._buildPipeline();
  }

  /**
   * Switch effect live. Returns new stream if switching between passthrough↔canvas.
   */
  async setEffect(effectConfig) {
    const prev = this._effect;
    this._effect = effectConfig;

    if (effectConfig.type === 'none') {
      this._teardownPipeline();
      return this._rawStream;
    }

    // Load MediaPipe if needed for blur/bg effects
    if ((effectConfig.type === 'blur' || effectConfig.type === 'bg') && !this._segmenter) {
      this._segmenter = await loadMediaPipe();
    }

    // If we were passthrough, build pipeline now
    if (prev.type === 'none' || !this._processedStream) {
      return this._buildPipeline();
    }

    // Already have canvas pipeline — just update effect config (no stream change)
    return null;
  }

  stop() {
    this._teardownPipeline();
    this._rawStream = null;
    this._segmenter = null;
  }

  _buildPipeline() {
    // Create hidden video element to read raw stream frames
    if (!this._video) {
      this._video = document.createElement('video');
      this._video.setAttribute('playsinline', '');
      this._video.muted = true;
    }
    this._video.srcObject = this._rawStream;
    this._video.play().catch(() => {});

    // Create processing canvas
    const track = this._rawStream.getVideoTracks()[0];
    const settings = track.getSettings();
    const w = settings.width || 640;
    const h = settings.height || 480;

    if (!this._canvas) {
      this._canvas = document.createElement('canvas');
    }
    this._canvas.width = w;
    this._canvas.height = h;
    this._ctx = this._canvas.getContext('2d', { willReadFrequently: true });

    // Temp canvas for segmented effects
    if (!this._tempCanvas) {
      this._tempCanvas = document.createElement('canvas');
    }
    this._tempCanvas.width = w;
    this._tempCanvas.height = h;
    this._tempCtx = this._tempCanvas.getContext('2d', { willReadFrequently: true });

    // Load segmenter if needed
    if ((this._effect.type === 'blur' || this._effect.type === 'bg') && !this._segmenter) {
      loadMediaPipe().then((s) => { this._segmenter = s; });
    }

    // Capture stream from canvas
    this._processedStream = this._canvas.captureStream(30);
    this._running = true;
    this._lastFrameTime = 0;
    this._drawLoop();
    return this._processedStream;
  }

  _teardownPipeline() {
    this._running = false;
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    if (this._video) {
      this._video.pause();
      this._video.srcObject = null;
    }
    if (this._processedStream) {
      this._processedStream.getTracks().forEach((t) => t.stop());
      this._processedStream = null;
    }
  }

  _drawLoop() {
    if (!this._running) return;
    this._rafId = requestAnimationFrame(() => {
      if (!this._running) return;
      this._drawFrame();
      this._drawLoop();
    });
  }

  _drawFrame() {
    const video = this._video;
    if (!video || video.readyState < 2) return;

    const ctx = this._ctx;
    const w = this._canvas.width;
    const h = this._canvas.height;
    const effect = this._effect;

    if (effect.type === 'filter') {
      ctx.filter = effect.filter;
      ctx.drawImage(video, 0, 0, w, h);
      ctx.filter = 'none';
      return;
    }

    if (effect.type === 'blur' || effect.type === 'bg') {
      this._applySegmentedEffect(video, w, h, effect);
      return;
    }

    // Fallback: draw raw frame
    ctx.drawImage(video, 0, 0, w, h);
  }

  _applySegmentedEffect(video, w, h, effect) {
    if (!this._segmenter) {
      // Segmenter not loaded yet — draw raw frame as fallback
      this._ctx.drawImage(video, 0, 0, w, h);
      return;
    }

    const now = performance.now();
    // Ensure monotonically increasing timestamp for MediaPipe
    const timestamp = now <= this._lastFrameTime ? this._lastFrameTime + 1 : now;
    this._lastFrameTime = timestamp;

    let result;
    try {
      result = this._segmenter.segmentForVideo(video, timestamp);
    } catch {
      this._ctx.drawImage(video, 0, 0, w, h);
      return;
    }

    const masks = result.confidenceMasks;
    if (!masks || masks.length === 0) {
      this._ctx.drawImage(video, 0, 0, w, h);
      return;
    }

    const mask = masks[0];
    const maskData = mask.getAsFloat32Array();

    // Draw background
    const ctx = this._ctx;
    const tempCtx = this._tempCtx;

    if (effect.type === 'blur') {
      // Draw blurred video as background
      ctx.filter = `blur(${effect.blurAmount}px)`;
      ctx.drawImage(video, 0, 0, w, h);
      ctx.filter = 'none';
    } else if (effect.type === 'bg') {
      // Draw solid/gradient background
      if (effect.gradient) {
        const grad = ctx.createLinearGradient(0, 0, w, h);
        const stops = effect.gradient;
        for (let i = 0; i < stops.length; i++) {
          grad.addColorStop(i / (stops.length - 1), stops[i]);
        }
        ctx.fillStyle = grad;
      } else {
        ctx.fillStyle = effect.bg;
      }
      ctx.fillRect(0, 0, w, h);
    }

    // Draw person on temp canvas
    tempCtx.drawImage(video, 0, 0, w, h);
    const personFrame = tempCtx.getImageData(0, 0, w, h);
    const pixels = personFrame.data;

    // Apply mask — maskData[i] is confidence that pixel is a person (0-1)
    for (let i = 0; i < maskData.length; i++) {
      const alpha = Math.round(maskData[i] * 255);
      pixels[i * 4 + 3] = alpha;
    }

    tempCtx.putImageData(personFrame, 0, 0);

    // Composite person over background
    ctx.drawImage(this._tempCanvas, 0, 0, w, h);

    // Free GPU memory
    mask.close();
  }
}
