// Voice quality test — sends real voice clips through server relay under simulated network conditions
// Tests jitter buffer, PLC, and resampling with realistic speech signals

import { io } from 'socket.io-client';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { floatToInt16, int16ToFloat, SAMPLE_RATE } from './lib/signals.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3001';
const CHANNEL_ID = 'voice-chat-2'; // Use second voice channel to avoid conflicts
const FRAME_DURATION_MS = 20;
const FRAME_SAMPLES = SAMPLE_RATE * FRAME_DURATION_MS / 1000; // 960 samples
const FRAME_BYTES = FRAME_SAMPLES * 2;
const GRACE_MS = 800; // longer grace for jitter tests

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Network condition definitions ──

const CONDITIONS = {
  ideal:        { packetLoss: 0,    jitterMs: 0,   desc: 'No loss, no jitter' },
  'low-loss':   { packetLoss: 0.05, jitterMs: 0,   desc: '5% packet loss' },
  'med-loss':   { packetLoss: 0.10, jitterMs: 0,   desc: '10% packet loss' },
  'high-loss':  { packetLoss: 0.20, jitterMs: 0,   desc: '20% packet loss' },
  'low-jitter': { packetLoss: 0,    jitterMs: 20,  desc: '20ms jitter' },
  'med-jitter': { packetLoss: 0,    jitterMs: 50,  desc: '50ms jitter' },
  'high-jitter':{ packetLoss: 0,    jitterMs: 100, desc: '100ms jitter' },
  combined:     { packetLoss: 0.05, jitterMs: 50,  desc: '5% loss + 50ms jitter' },
};

// ── Pass thresholds per condition ──

const THRESHOLDS = {
  ideal:        { snr: 80, maxDropouts: 0,  maxGapMs: 0 },
  'low-loss':   { snr: 70, maxDropouts: 3,  maxGapMs: 100 },
  'med-loss':   { snr: 55, maxDropouts: 8,  maxGapMs: 250 },
  'high-loss':  { snr: 40, maxDropouts: 15, maxGapMs: 500 },
  'low-jitter': { snr: 75, maxDropouts: 0,  maxGapMs: 0 },
  'med-jitter': { snr: 65, maxDropouts: 2,  maxGapMs: 150 },
  'high-jitter':{ snr: 50, maxDropouts: 5,  maxGapMs: 300 },
  combined:     { snr: 55, maxDropouts: 5,  maxGapMs: 200 },
};

// ── Helpers ──

function connectClient(name) {
  return new Promise((resolve, reject) => {
    const socket = io(SERVER_URL, { transports: ['websocket'] });
    const timeout = setTimeout(() => reject(new Error(`${name}: connection timeout`)), 5000);

    socket.on('connect', () => {
      clearTimeout(timeout);
      socket.emit('user:login', { username: name }, (res) => {
        if (!res.success) return reject(new Error(`${name}: login failed — ${res.error}`));
        resolve(socket);
      });
    });

    socket.on('connect_error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`${name}: connect error — ${err.message}`));
    });
  });
}

function joinVoice(socket, channelId) {
  return new Promise((resolve, reject) => {
    socket.emit('voice:join', { channelId, capabilities: { opus: false } }, (res) => {
      if (!res?.success) return reject(new Error('voice:join failed'));
      resolve(res);
    });
  });
}

/**
 * Load a .f32 fixture file as Float32Array.
 */
function loadVoiceFixture(filename) {
  const path = resolve(__dirname, 'fixtures/voices', filename);
  if (!existsSync(path)) return null;
  const buf = readFileSync(path);
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

/**
 * Send signal with simulated network conditions.
 * packetLoss: probability [0, 1] of dropping each frame
 * jitterMs: max random delay added to each frame (uniform distribution)
 */
async function sendSignalWithConditions(socket, signal, channelId, { packetLoss, jitterMs }) {
  const int16Buf = floatToInt16(signal);
  const totalFrames = Math.floor(signal.length / FRAME_SAMPLES);
  const startTime = performance.now();
  let sentCount = 0;
  let droppedCount = 0;

  const pendingSends = [];

  for (let i = 0; i < totalFrames; i++) {
    // Simulate packet loss
    if (packetLoss > 0 && Math.random() < packetLoss) {
      droppedCount++;
      // Still wait for timing
      const elapsed = performance.now() - startTime;
      const targetTime = (i + 1) * FRAME_DURATION_MS;
      const sleepTime = targetTime - elapsed;
      if (sleepTime > 0) await sleep(sleepTime);
      continue;
    }

    // Create frame
    const frameCopy = new ArrayBuffer(FRAME_BYTES);
    new Int16Array(frameCopy).set(new Int16Array(int16Buf, i * FRAME_BYTES, FRAME_SAMPLES));

    const seq = i;

    // Simulate jitter: add random delay
    const jitter = jitterMs > 0 ? Math.random() * jitterMs : 0;

    const sendFn = () => {
      socket.emit('audio:chunk', {
        channelId,
        data: frameCopy,
        sampleRate: SAMPLE_RATE,
        seq,
      });
      sentCount++;
    };

    if (jitter > 0) {
      // Schedule delayed send
      pendingSends.push(setTimeout(sendFn, jitter));
    } else {
      sendFn();
    }

    // Drift-compensated sleep
    const elapsed = performance.now() - startTime;
    const targetTime = (i + 1) * FRAME_DURATION_MS;
    const sleepTime = targetTime - elapsed;
    if (sleepTime > 0) await sleep(sleepTime);
  }

  // Wait for any jittered sends to complete
  if (jitterMs > 0) {
    await sleep(jitterMs + 50);
  }

  // Clean up pending timeouts
  for (const t of pendingSends) clearTimeout(t);

  return { totalFrames, sentCount: sentCount, droppedCount };
}

/**
 * Compute simple metrics on received audio.
 */
function computeMetrics(input, output, receivedSeqs, sentFrames) {
  // SNR via cross-correlation alignment
  const lag = findLag(output, input);
  const alignedOutput = output.slice(Math.max(0, lag));
  const len = Math.min(input.length, alignedOutput.length);

  let signalPower = 0, noisePower = 0;
  for (let i = 0; i < len; i++) {
    signalPower += input[i] * input[i];
    const diff = input[i] - alignedOutput[i];
    noisePower += diff * diff;
  }
  const snrDb = noisePower === 0 ? Infinity : 10 * Math.log10(signalPower / noisePower);

  // Dropout detection
  const dropoutThreshold = 0.0001;
  const minDropoutSamples = Math.ceil(SAMPLE_RATE * 0.001); // 1ms
  let dropoutCount = 0;
  let totalGapSamples = 0;
  let runStart = -1;

  for (let i = 0; i < output.length; i++) {
    if (Math.abs(output[i]) < dropoutThreshold) {
      if (runStart === -1) runStart = i;
    } else {
      if (runStart !== -1) {
        const runLen = i - runStart;
        if (runLen >= minDropoutSamples) {
          // Check if input had energy
          const inputStart = Math.min(runStart, input.length - 1);
          const inputEnd = Math.min(i, input.length);
          let refEnergy = 0;
          for (let j = inputStart; j < inputEnd; j++) refEnergy += Math.abs(input[j]);
          if (refEnergy / runLen > dropoutThreshold * 10) {
            dropoutCount++;
            totalGapSamples += runLen;
          }
        }
        runStart = -1;
      }
    }
  }

  const totalGapMs = (totalGapSamples / SAMPLE_RATE) * 1000;

  // Spectral preservation (200Hz-4kHz band energy ratio)
  const spectralPreservation = computeSpectralPreservation(input, output, lag);

  // Delivery percentage
  const deliveryPct = sentFrames > 0
    ? Math.round((receivedSeqs.length / sentFrames) * 10000) / 100
    : 0;

  // Latency estimate from lag
  const latencyMs = (Math.abs(lag) / SAMPLE_RATE) * 1000;

  return {
    snrDb: Math.round(snrDb * 100) / 100,
    latencyMs: Math.round(latencyMs * 100) / 100,
    dropoutCount,
    totalGapMs: Math.round(totalGapMs * 100) / 100,
    spectralPreservation: Math.round(spectralPreservation * 1000) / 1000,
    deliveryPct,
  };
}

/**
 * Simple cross-correlation lag finder.
 */
function findLag(output, reference) {
  const searchRange = Math.min(SAMPLE_RATE, output.length, reference.length);
  const blockLen = Math.min(4096, reference.length);
  let bestCorr = -Infinity;
  let bestLag = 0;

  for (let lag = 0; lag < searchRange; lag += 1) {
    let corr = 0;
    const len = Math.min(blockLen, output.length - lag, reference.length);
    for (let i = 0; i < len; i++) {
      corr += output[lag + i] * reference[i];
    }
    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
    // Early exit optimization: skip ahead if correlation is very low
    if (lag > 1000 && corr < bestCorr * 0.1) break;
  }

  return bestLag;
}

/**
 * Spectral preservation: ratio of speech-band energy (200Hz-4kHz) in output vs input.
 * Returns ratio [0, 1+], where 1.0 = perfect preservation.
 */
function computeSpectralPreservation(input, output, lag) {
  const aligned = output.slice(Math.max(0, lag));
  const len = Math.min(input.length, aligned.length, SAMPLE_RATE); // analyze first 1s

  // Simple band-pass energy: approximate with DFT at key frequencies
  const freqs = [200, 500, 1000, 1500, 2000, 2500, 3000, 3500, 4000];
  let inputEnergy = 0, outputEnergy = 0;

  for (const freq of freqs) {
    let inReal = 0, inImag = 0, outReal = 0, outImag = 0;
    for (let i = 0; i < len; i++) {
      const angle = 2 * Math.PI * freq * i / SAMPLE_RATE;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      inReal += input[i] * cos;
      inImag += input[i] * sin;
      outReal += aligned[i] * cos;
      outImag += aligned[i] * sin;
    }
    inputEnergy += inReal * inReal + inImag * inImag;
    outputEnergy += outReal * outReal + outImag * outImag;
  }

  return inputEnergy > 0 ? outputEnergy / inputEnergy : 0;
}

/**
 * Run voice quality test across all conditions and voice clips.
 * @param {string} resultsDir - directory to write output files
 * @returns {Object} results
 */
export async function runVoiceQualityTest(resultsDir) {
  mkdirSync(resultsDir, { recursive: true });

  // Load voice fixtures
  const manifestPath = resolve(__dirname, 'fixtures/voices/manifest.json');
  if (!existsSync(manifestPath)) {
    console.log('[VoiceQuality] No voice fixtures found. Run: node tests/scripts/prepare-voices.js');
    return null;
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  const clips = [];
  for (const clip of manifest.clips) {
    const data = loadVoiceFixture(clip.file);
    if (data) {
      clips.push({ ...clip, data });
    } else {
      console.log(`[VoiceQuality] Missing fixture: ${clip.file}, skipping`);
    }
  }

  if (clips.length === 0) {
    console.log('[VoiceQuality] No voice fixtures loaded. Run: node tests/scripts/prepare-voices.js');
    return null;
  }

  console.log(`[VoiceQuality] Loaded ${clips.length} voice clips`);

  // Connect clients
  console.log(`[VoiceQuality] Connecting to ${SERVER_URL}...`);
  const sender = await connectClient('voice-sender');
  const receiver = await connectClient('voice-receiver');

  console.log('[VoiceQuality] Joining voice channel...');
  await joinVoice(sender, CHANNEL_ID);
  await sleep(200);
  await joinVoice(receiver, CHANNEL_ID);
  await sleep(500);

  const results = {};

  // Use first 2 clips for the full condition matrix (to keep test time reasonable)
  const testClips = clips.slice(0, 2);

  for (const [condName, cond] of Object.entries(CONDITIONS)) {
    console.log(`\n[VoiceQuality] ── Condition: ${condName} (${cond.desc}) ──`);
    const condResults = [];

    for (const clip of testClips) {
      console.log(`[VoiceQuality]   Clip: ${clip.id} (${clip.fundamental}Hz)`);

      // Collect received frames
      const receivedFrames = [];
      const receivedSeqs = [];

      const onChunk = ({ from, data, seq }) => {
        if (from === sender.id) {
          receivedSeqs.push(seq ?? receivedFrames.length);
          const f32 = int16ToFloat(data);
          receivedFrames.push(f32);
        }
      };

      receiver.on('audio:chunk', onChunk);

      // Send with simulated conditions
      const sendResult = await sendSignalWithConditions(sender, clip.data, CHANNEL_ID, cond);

      // Grace period
      await sleep(GRACE_MS);
      receiver.off('audio:chunk', onChunk);

      // Assemble output
      let totalSamples = 0;
      for (const frame of receivedFrames) totalSamples += frame.length;
      const output = new Float32Array(totalSamples);
      let offset = 0;
      for (const frame of receivedFrames) {
        output.set(frame, offset);
        offset += frame.length;
      }

      // Compute metrics
      const metrics = computeMetrics(clip.data, output, receivedSeqs, sendResult.totalFrames);
      metrics.clipId = clip.id;
      metrics.framesSent = sendResult.totalFrames;
      metrics.framesDropped = sendResult.droppedCount;
      metrics.framesReceived = receivedFrames.length;

      condResults.push(metrics);

      console.log(
        `[VoiceQuality]     SNR=${metrics.snrDb}dB lat=${metrics.latencyMs}ms dropouts=${metrics.dropoutCount} ` +
        `gap=${metrics.totalGapMs}ms spectral=${metrics.spectralPreservation} delivery=${metrics.deliveryPct}%`
      );

      await sleep(200);
    }

    // Average metrics across clips for this condition
    const avg = {
      condition: condName,
      description: cond.desc,
      packetLoss: cond.packetLoss,
      jitterMs: cond.jitterMs,
      clips: condResults,
      avgSnrDb: Math.round(condResults.reduce((s, r) => s + r.snrDb, 0) / condResults.length * 100) / 100,
      avgLatencyMs: Math.round(condResults.reduce((s, r) => s + r.latencyMs, 0) / condResults.length * 100) / 100,
      totalDropouts: condResults.reduce((s, r) => s + r.dropoutCount, 0),
      totalGapMs: Math.round(condResults.reduce((s, r) => s + r.totalGapMs, 0) * 100) / 100,
      avgSpectralPreservation: Math.round(condResults.reduce((s, r) => s + r.spectralPreservation, 0) / condResults.length * 1000) / 1000,
      avgDeliveryPct: Math.round(condResults.reduce((s, r) => s + r.deliveryPct, 0) / condResults.length * 100) / 100,
    };

    // Pass/fail verdict
    const thresh = THRESHOLDS[condName];
    if (thresh) {
      avg.pass = avg.avgSnrDb >= thresh.snr &&
                 avg.totalDropouts <= thresh.maxDropouts &&
                 avg.totalGapMs <= thresh.maxGapMs;
      avg.thresholds = thresh;
    }

    results[condName] = avg;
  }

  // Save results
  writeFileSync(`${resultsDir}/voice-quality.json`, JSON.stringify(results, null, 2));

  // Cleanup
  sender.emit('voice:leave', { channelId: CHANNEL_ID });
  receiver.emit('voice:leave', { channelId: CHANNEL_ID });
  await sleep(100);
  sender.disconnect();
  receiver.disconnect();

  console.log(`\n[VoiceQuality] Results written to ${resultsDir}/voice-quality.json`);
  return results;
}

// Run directly
if (process.argv[1]?.endsWith('voice-quality-test.js')) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const resultsDir = resolve(__dirname, `results/run-${timestamp}`);

  runVoiceQualityTest(resultsDir)
    .then((results) => {
      if (results) {
        console.log('\n[VoiceQuality] Summary:');
        for (const [cond, r] of Object.entries(results)) {
          console.log(`  ${cond}: SNR=${r.avgSnrDb}dB dropouts=${r.totalDropouts} gap=${r.totalGapMs}ms ${r.pass ? 'PASS' : 'FAIL'}`);
        }
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error('[VoiceQuality] Error:', err);
      process.exit(1);
    });
}
