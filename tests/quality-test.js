// Audio fidelity test — 2 Socket.IO clients, known signals through server relay

import { io } from 'socket.io-client';
import { writeFileSync, mkdirSync } from 'fs';
import { ALL_SIGNALS, floatToInt16, int16ToFloat, SAMPLE_RATE, NUM_SAMPLES } from './lib/signals.js';

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3001';
const CHANNEL_ID = 'voice-chat-1';
const FRAME_DURATION_MS = 20;
const FRAME_SAMPLES = SAMPLE_RATE * FRAME_DURATION_MS / 1000; // 960 samples
const FRAME_BYTES = FRAME_SAMPLES * 2; // Int16 = 2 bytes per sample
const GRACE_MS = 500;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function connectClient(name) {
  return new Promise((resolve, reject) => {
    const socket = io(SERVER_URL, { transports: ['websocket'] });
    const timeout = setTimeout(() => reject(new Error(`${name}: connection timeout`)), 5000);

    socket.on('connect', () => {
      clearTimeout(timeout);
      // Login
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
      if (!res?.success) return reject(new Error(`voice:join failed`));
      resolve(res);
    });
  });
}

/**
 * Send a Float32 signal as Int16 PCM frames at 20ms intervals.
 * Uses drift-compensated timing to maintain accurate frame rate.
 */
async function sendSignal(socket, signal, channelId) {
  const int16Buf = floatToInt16(signal);
  const int16 = new Int16Array(int16Buf);
  const totalFrames = Math.floor(int16.length / FRAME_SAMPLES);

  const startTime = performance.now();

  for (let i = 0; i < totalFrames; i++) {
    const frameData = int16.slice(i * FRAME_SAMPLES, (i + 1) * FRAME_SAMPLES).buffer.slice(
      int16.slice(i * FRAME_SAMPLES, (i + 1) * FRAME_SAMPLES).byteOffset,
    );

    // Create a clean copy of the frame buffer
    const frameCopy = new ArrayBuffer(FRAME_BYTES);
    new Int16Array(frameCopy).set(new Int16Array(int16Buf, i * FRAME_BYTES, FRAME_SAMPLES));

    socket.emit('audio:chunk', {
      channelId,
      data: frameCopy,
      sampleRate: SAMPLE_RATE,
      seq: i,
    });

    // Drift-compensated sleep
    const elapsed = performance.now() - startTime;
    const targetTime = (i + 1) * FRAME_DURATION_MS;
    const sleepTime = targetTime - elapsed;
    if (sleepTime > 0) {
      await sleep(sleepTime);
    }
  }

  return totalFrames;
}

/**
 * Run the quality test for all signal types.
 * @param {string} resultsDir - directory to write output files
 * @returns {Object} results per signal type
 */
export async function runQualityTest(resultsDir) {
  mkdirSync(resultsDir, { recursive: true });

  console.log(`[Quality] Connecting to ${SERVER_URL}...`);
  const sender = await connectClient('test-sender');
  const receiver = await connectClient('test-receiver');

  console.log('[Quality] Joining voice channel...');
  await joinVoice(sender, CHANNEL_ID);
  await sleep(200); // Let server process
  await joinVoice(receiver, CHANNEL_ID);
  await sleep(500); // Wait for voice:user-joined events

  const results = {};

  for (const [name, generator] of Object.entries(ALL_SIGNALS)) {
    console.log(`[Quality] Testing signal: ${name}`);

    // Generate input signal
    const input = generator();

    // Save raw input
    writeFileSync(`${resultsDir}/input-${name}.f32`, Buffer.from(input.buffer));

    // Collect received frames
    const receivedFrames = [];
    const receivedSeqs = [];

    const onChunk = ({ from, data, seq }) => {
      if (from === sender.id) {
        receivedSeqs.push(seq || receivedFrames.length);
        // Convert Int16 back to Float32 (matching useVoice.js decode path)
        const f32 = int16ToFloat(data);
        receivedFrames.push(f32);
      }
    };

    receiver.on('audio:chunk', onChunk);

    // Send signal
    const totalFrames = await sendSignal(sender, input, CHANNEL_ID);

    // Grace period for remaining frames
    await sleep(GRACE_MS);
    receiver.off('audio:chunk', onChunk);

    // Assemble output from received frames
    let totalSamples = 0;
    for (const frame of receivedFrames) totalSamples += frame.length;

    const output = new Float32Array(totalSamples);
    let offset = 0;
    for (const frame of receivedFrames) {
      output.set(frame, offset);
      offset += frame.length;
    }

    // Save raw output
    writeFileSync(`${resultsDir}/output-${name}.f32`, Buffer.from(output.buffer));

    // Save sequence data
    writeFileSync(`${resultsDir}/seqs-${name}.json`, JSON.stringify({
      sent: totalFrames,
      received: receivedSeqs,
    }));

    results[name] = {
      inputSamples: input.length,
      outputSamples: output.length,
      framesSent: totalFrames,
      framesReceived: receivedFrames.length,
      deliveryPct: Math.round((receivedFrames.length / totalFrames) * 10000) / 100,
    };

    console.log(`[Quality]   ${name}: sent=${totalFrames} recv=${receivedFrames.length} (${results[name].deliveryPct}%)`);

    // Small pause between signals
    await sleep(200);
  }

  // Cleanup
  sender.emit('voice:leave', { channelId: CHANNEL_ID });
  receiver.emit('voice:leave', { channelId: CHANNEL_ID });
  await sleep(100);
  sender.disconnect();
  receiver.disconnect();

  return results;
}

// Run directly
if (process.argv[1]?.endsWith('quality-test.js')) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const resultsDir = new URL(`./results/run-${timestamp}`, import.meta.url).pathname;

  runQualityTest(resultsDir)
    .then((results) => {
      console.log('\n[Quality] Results:', JSON.stringify(results, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error('[Quality] Error:', err);
      process.exit(1);
    });
}
