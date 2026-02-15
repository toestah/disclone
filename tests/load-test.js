// Load/scale test — N clients, 1 sender, N-1 receivers, escalating client counts

import { io } from 'socket.io-client';
import { writeFileSync, mkdirSync } from 'fs';
import { pureSine, floatToInt16, SAMPLE_RATE } from './lib/signals.js';

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3001';
const CHANNEL_ID = 'voice-chat-1';
const FRAME_DURATION_MS = 20;
const FRAME_SAMPLES = SAMPLE_RATE * FRAME_DURATION_MS / 1000; // 960
const FRAME_BYTES = FRAME_SAMPLES * 2;
const TEST_DURATION_S = 10;
const FRAMES_PER_SECOND = 1000 / FRAME_DURATION_MS; // 50
const TOTAL_FRAMES = TEST_DURATION_S * FRAMES_PER_SECOND; // 500

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

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

function joinVoice(socket) {
  return new Promise((resolve, reject) => {
    socket.emit('voice:join', { channelId: CHANNEL_ID, capabilities: { opus: false } }, (res) => {
      if (!res?.success) return reject(new Error('voice:join failed'));
      resolve(res);
    });
  });
}

/**
 * Run load test with a specific number of clients.
 * @param {number} numClients - total clients (1 sender + numClients-1 receivers)
 * @returns {Object} metrics for this client count
 */
async function runWithClients(numClients) {
  console.log(`[Load] Testing with ${numClients} clients...`);

  // Generate 10s of 440Hz sine as Int16 PCM
  const signal = pureSine(440);
  const int16Buf = floatToInt16(signal);

  // Connect all clients
  const clients = [];
  try {
    for (let i = 0; i < numClients; i++) {
      const socket = await connectClient(`load-${numClients}-${i}`);
      clients.push(socket);
    }
  } catch (err) {
    // Clean up any connected clients
    clients.forEach((s) => s.disconnect());
    return { error: err.message, numClients };
  }

  // All join voice
  for (const socket of clients) {
    await joinVoice(socket);
    await sleep(50);
  }
  await sleep(500); // Settle

  const sender = clients[0];
  const receivers = clients.slice(1);

  // Track received packets per receiver
  const receiverData = receivers.map(() => ({
    receivedSeqs: [],
    timestamps: [],
  }));

  receivers.forEach((socket, idx) => {
    socket.on('audio:chunk', ({ from, seq }) => {
      if (from === sender.id) {
        receiverData[idx].receivedSeqs.push(seq || 0);
        receiverData[idx].timestamps.push(performance.now());
      }
    });
  });

  // Send frames
  const sendStart = performance.now();
  const sendTimestamps = [];

  for (let i = 0; i < TOTAL_FRAMES; i++) {
    const frameStart = i * FRAME_SAMPLES;
    if (frameStart + FRAME_SAMPLES > new Int16Array(int16Buf).length) break;

    const frameCopy = new ArrayBuffer(FRAME_BYTES);
    new Int16Array(frameCopy).set(new Int16Array(int16Buf, frameStart * 2, FRAME_SAMPLES));

    sender.emit('audio:chunk', {
      channelId: CHANNEL_ID,
      data: frameCopy,
      sampleRate: SAMPLE_RATE,
      seq: i,
    });

    sendTimestamps.push(performance.now());

    // Drift-compensated sleep
    const elapsed = performance.now() - sendStart;
    const targetTime = (i + 1) * FRAME_DURATION_MS;
    const sleepTime = targetTime - elapsed;
    if (sleepTime > 0) await sleep(sleepTime);
  }

  // Grace period
  await sleep(1000);

  // Compute metrics
  const framesSent = sendTimestamps.length;
  const perReceiver = receiverData.map((data, idx) => {
    const received = data.receivedSeqs.length;
    const deliveryPct = Math.round((received / framesSent) * 10000) / 100;

    // Compute relay latency estimates (time between send and receive for matched seqs)
    const latencies = [];
    for (let j = 0; j < data.receivedSeqs.length; j++) {
      const seq = data.receivedSeqs[j];
      if (seq < sendTimestamps.length) {
        latencies.push(data.timestamps[j] - sendTimestamps[seq]);
      }
    }
    latencies.sort((a, b) => a - b);

    return {
      receiverId: idx,
      received,
      deliveryPct,
      latencyMedianMs: latencies.length > 0 ? Math.round(latencies[Math.floor(latencies.length / 2)] * 100) / 100 : null,
      latencyP95Ms: latencies.length > 0 ? Math.round(latencies[Math.floor(latencies.length * 0.95)] * 100) / 100 : null,
      latencyMaxMs: latencies.length > 0 ? Math.round(Math.max(...latencies) * 100) / 100 : null,
    };
  });

  // Aggregate
  const avgDelivery = perReceiver.reduce((sum, r) => sum + r.deliveryPct, 0) / perReceiver.length;
  const allLatencies = perReceiver.filter((r) => r.latencyMedianMs !== null);
  const medianLatency = allLatencies.length > 0
    ? Math.round(allLatencies.reduce((sum, r) => sum + r.latencyMedianMs, 0) / allLatencies.length * 100) / 100
    : null;
  const p95Latency = allLatencies.length > 0
    ? Math.round(Math.max(...allLatencies.map((r) => r.latencyP95Ms)) * 100) / 100
    : null;

  // Cleanup
  clients.forEach((s) => {
    s.emit('voice:leave', { channelId: CHANNEL_ID });
  });
  await sleep(100);
  clients.forEach((s) => s.disconnect());

  const result = {
    numClients,
    framesSent,
    avgDeliveryPct: Math.round(avgDelivery * 100) / 100,
    latencyMedianMs: medianLatency,
    latencyP95Ms: p95Latency,
    perReceiver,
  };

  console.log(`[Load]   ${numClients} clients: delivery=${result.avgDeliveryPct}% latency_median=${medianLatency}ms p95=${p95Latency}ms`);
  return result;
}

/**
 * Run load test with escalating client counts.
 * @param {string} resultsDir - directory to write output
 * @param {number[]} clientCounts - array of client counts to test
 * @returns {Object} results per client count
 */
export async function runLoadTest(resultsDir, clientCounts = [10, 15, 20, 25, 30]) {
  mkdirSync(resultsDir, { recursive: true });

  const results = {};
  let scaleCeiling = null;

  for (const count of clientCounts) {
    // Wait between rounds for server to clean up
    await sleep(1000);

    const result = await runWithClients(count);
    results[`${count}_clients`] = result;

    if (!result.error && result.avgDeliveryPct < 95 && !scaleCeiling) {
      scaleCeiling = count;
      console.log(`[Load] Scale ceiling found at ${count} clients (delivery < 95%)`);
    }
  }

  results.scaleCeiling = scaleCeiling;

  writeFileSync(`${resultsDir}/load-test.json`, JSON.stringify(results, null, 2));
  console.log(`[Load] Results written to ${resultsDir}/load-test.json`);
  return results;
}

// Run directly
if (process.argv[1]?.endsWith('load-test.js')) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const resultsDir = new URL(`./results/run-${timestamp}`, import.meta.url).pathname;

  // Parse --clients flag
  const clientsIdx = process.argv.indexOf('--clients');
  const maxClients = clientsIdx !== -1 ? parseInt(process.argv[clientsIdx + 1], 10) : 10;
  const counts = [];
  for (let c = 10; c <= maxClients; c += 5) counts.push(c);
  if (counts.length === 0) counts.push(maxClients);

  runLoadTest(resultsDir, counts)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[Load] Error:', err);
      process.exit(1);
    });
}
