#!/usr/bin/env node

// Orchestrator — starts server (optionally), runs tests, runs analysis, prints report

import { spawn } from 'child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'fs';
import { execSync } from 'child_process';
import { runQualityTest } from './quality-test.js';
import { runLoadTest } from './load-test.js';
import { runVadTest } from './vad-test.js';
import { analyze } from './analyze.js';

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3001';
const START_SERVER = process.argv.includes('--start-server');
const SKIP_LOAD = process.argv.includes('--skip-load');
const SKIP_QUALITY = process.argv.includes('--skip-quality');
const SKIP_VAD = process.argv.includes('--skip-vad');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Wait for server to be reachable.
 */
async function waitForServer(url, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 404) return true; // Server is up
    } catch {
      // Not ready yet
    }
    await sleep(500);
  }
  throw new Error(`Server not reachable at ${url} after ${timeoutMs}ms`);
}

async function main() {
  // ── Setup results directory ──
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const resultsDir = new URL(`./results/run-${timestamp}`, import.meta.url).pathname;
  mkdirSync(resultsDir, { recursive: true });

  // ── Write meta.json ──
  let gitHash = 'unknown';
  try {
    gitHash = execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
  } catch { /* not a git repo or git not available */ }

  const meta = {
    timestamp: new Date().toISOString(),
    gitHash,
    serverUrl: SERVER_URL,
    startedServer: START_SERVER,
    skipLoad: SKIP_LOAD,
    skipQuality: SKIP_QUALITY,
    skipVad: SKIP_VAD,
  };
  writeFileSync(`${resultsDir}/meta.json`, JSON.stringify(meta, null, 2));

  // ── Optionally start server ──
  let serverProcess = null;
  if (START_SERVER) {
    console.log('[Run] Starting server...');
    const serverDir = new URL('../server', import.meta.url).pathname;
    serverProcess = spawn('node', ['index.js'], {
      cwd: serverDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PORT: '3001' },
    });

    serverProcess.stdout.on('data', (data) => {
      const line = data.toString().trim();
      if (line) console.log(`[Server] ${line}`);
    });

    serverProcess.stderr.on('data', (data) => {
      const line = data.toString().trim();
      if (line) console.error(`[Server] ${line}`);
    });

    try {
      await waitForServer(SERVER_URL);
      console.log('[Run] Server is ready');
    } catch (err) {
      console.error(`[Run] ${err.message}`);
      serverProcess.kill();
      process.exit(1);
    }
  } else {
    // Verify server is reachable
    console.log(`[Run] Checking server at ${SERVER_URL}...`);
    try {
      await waitForServer(SERVER_URL, 3000);
      console.log('[Run] Server is reachable');
    } catch {
      console.error(`[Run] Server not reachable at ${SERVER_URL}. Use --start-server or start it manually.`);
      process.exit(1);
    }
  }

  try {
    // ── Run load test ──
    if (!SKIP_LOAD) {
      console.log('\n[Run] ═══ Load Test ═══');
      const loadCounts = [10, 15, 20, 25, 30];
      await runLoadTest(resultsDir, loadCounts);
    }

    // ── Run VAD test (pure computation, no server needed) ──
    if (!SKIP_VAD) {
      console.log('\n[Run] ═══ VAD Test ═══');
      runVadTest(resultsDir);
    }

    // ── Run quality test ──
    if (!SKIP_QUALITY) {
      console.log('\n[Run] ═══ Quality Test ═══');
      await runQualityTest(resultsDir);
    }

    // ── Run analysis ──
    console.log('\n[Run] ═══ Analysis ═══');
    const { report, hasFailures } = analyze(resultsDir);

    // ── Print report ──
    console.log('\n' + '═'.repeat(60));
    console.log(report);
    console.log('═'.repeat(60));

    console.log(`\n[Run] Results saved to: ${resultsDir}`);
    console.log(`[Run] ${hasFailures ? 'FAIL — some metrics below threshold' : 'PASS — all metrics within threshold'}`);

    return hasFailures ? 1 : 0;
  } finally {
    if (serverProcess) {
      console.log('[Run] Stopping server...');
      serverProcess.kill('SIGTERM');
      // Give it a moment to shut down gracefully
      await sleep(500);
      if (!serverProcess.killed) serverProcess.kill('SIGKILL');
    }
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('[Run] Fatal error:', err);
    process.exit(1);
  });
