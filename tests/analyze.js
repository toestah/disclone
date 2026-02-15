// Analyze test results — reads .f32 files, computes metrics, generates report

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { snr, thd, latency, dropouts, spectralDiff, packetStats } from './lib/metrics.js';

const SAMPLE_RATE = 48000;

const SIGNAL_NAMES = ['sweep', 'sine', 'impulse', 'noise', 'speech'];

/**
 * Load a .f32 file as Float32Array.
 */
function loadF32(path) {
  const buf = readFileSync(path);
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

/**
 * Thresholds for pass/warn/fail verdicts.
 */
const THRESHOLDS = {
  snr: { pass: 80, warn: 60 },       // dB — 16-bit PCM tops out ~84dB with 32767/32768 asymmetry
  thd: { pass: 0.5, warn: 2.0 },     // % (lower is better)
  latency: { pass: 100, warn: 200 },  // ms (lower is better)
  dropouts: { pass: 0, warn: 3 },     // count (lower is better)
  delivery: { pass: 99, warn: 95 },   // % (higher is better)
};

function verdict(metric, value) {
  const t = THRESHOLDS[metric];
  if (!t) return 'N/A';

  // For metrics where lower is better
  if (metric === 'thd' || metric === 'latency' || metric === 'dropouts') {
    if (value <= t.pass) return 'PASS';
    if (value <= t.warn) return 'WARN';
    return 'FAIL';
  }
  // For metrics where higher is better
  if (value >= t.pass) return 'PASS';
  if (value >= t.warn) return 'WARN';
  return 'FAIL';
}

/**
 * Run analysis on a test results directory.
 * @param {string} resultsDir - path to results/run-{timestamp}/
 * @returns {Object} { metrics, spectral, report, hasFailures }
 */
export function analyze(resultsDir) {
  const metrics = { signals: {}, load_test: null, vad: null };
  const spectral = {};
  let hasFailures = false;
  let hasWarnings = false;

  // ── Analyze each signal ──
  for (const name of SIGNAL_NAMES) {
    const inputPath = `${resultsDir}/input-${name}.f32`;
    const outputPath = `${resultsDir}/output-${name}.f32`;
    const seqsPath = `${resultsDir}/seqs-${name}.json`;

    if (!existsSync(inputPath) || !existsSync(outputPath)) {
      console.log(`[Analyze] Skipping ${name} — files not found`);
      continue;
    }

    const input = loadF32(inputPath);
    const output = loadF32(outputPath);

    console.log(`[Analyze] ${name}: input=${input.length} samples, output=${output.length} samples`);

    // Compute metrics
    const signalSnr = snr(input, output);
    const signalLatency = latency(input, output, SAMPLE_RATE);
    const signalDropouts = dropouts(output, SAMPLE_RATE, 0.0001, 1, input);

    // THD only meaningful for sine
    let signalThd = null;
    if (name === 'sine') {
      signalThd = thd(output, 1000, SAMPLE_RATE);
    }

    // Packet delivery stats
    let pktStats = null;
    if (existsSync(seqsPath)) {
      const seqData = JSON.parse(readFileSync(seqsPath, 'utf-8'));
      pktStats = packetStats(seqData.received, seqData.sent);
    }

    // Spectral analysis
    const specDiff = spectralDiff(input, output, 1024, 512, SAMPLE_RATE);
    spectral[name] = specDiff;

    const signalMetrics = {
      snr_db: Math.round(signalSnr * 100) / 100,
      thd_pct: signalThd !== null ? Math.round(signalThd * 1000) / 1000 : null,
      latency_ms: Math.round(signalLatency * 100) / 100,
      dropout_count: signalDropouts.length,
      dropout_details: signalDropouts.slice(0, 10), // Cap detail output
      packet_delivery_pct: pktStats?.deliveryPct ?? null,
      packet_out_of_order: pktStats?.outOfOrder ?? null,
      packet_max_gap: pktStats?.maxGap ?? null,
    };

    metrics.signals[name] = signalMetrics;

    // Check verdicts
    if (verdict('snr', signalSnr) === 'FAIL') hasFailures = true;
    if (verdict('snr', signalSnr) === 'WARN') hasWarnings = true;
    if (signalThd !== null && verdict('thd', signalThd) === 'FAIL') hasFailures = true;
    if (signalThd !== null && verdict('thd', signalThd) === 'WARN') hasWarnings = true;
    if (verdict('latency', signalLatency) === 'FAIL') hasFailures = true;
    if (verdict('dropouts', signalDropouts.length) === 'FAIL') hasFailures = true;
    if (pktStats && verdict('delivery', pktStats.deliveryPct) === 'FAIL') hasFailures = true;
  }

  // ── Load test results ──
  const loadPath = `${resultsDir}/load-test.json`;
  if (existsSync(loadPath)) {
    const loadData = JSON.parse(readFileSync(loadPath, 'utf-8'));
    metrics.load_test = {};
    for (const [key, value] of Object.entries(loadData)) {
      if (key === 'scaleCeiling') {
        metrics.load_test.scaleCeiling = value;
        continue;
      }
      if (value && typeof value === 'object' && !value.error) {
        metrics.load_test[key] = {
          delivery_pct: value.avgDeliveryPct,
          latency_median_ms: value.latencyMedianMs,
          latency_p95_ms: value.latencyP95Ms,
        };
      }
    }
  }

  // ── VAD test results ──
  const vadPath = `${resultsDir}/vad-test.json`;
  if (existsSync(vadPath)) {
    const vadData = JSON.parse(readFileSync(vadPath, 'utf-8'));
    metrics.vad = vadData;

    // VAD pass/fail: noise-only signals should have <5% false activation (new algo)
    for (const [name, data] of Object.entries(vadData)) {
      if (data.expectGate === 'closed' && data.new.falseActivationPct > 5) {
        hasFailures = true;
      }
      if (data.expectGate === 'open' && data.new.gatePct < 80) {
        hasFailures = true;
      }
      if (data.expectGate === 'closed' && data.new.falseActivationPct > 0) {
        hasWarnings = true;
      }
    }
  }

  // ── Generate report ──
  const report = generateReport(metrics, spectral, hasFailures, hasWarnings);

  // ── Write output files ──
  writeFileSync(`${resultsDir}/metrics.json`, JSON.stringify(metrics, null, 2));
  writeFileSync(`${resultsDir}/spectral.json`, JSON.stringify(spectral, null, 2));
  writeFileSync(`${resultsDir}/report.md`, report);

  console.log(`[Analyze] Written: metrics.json, spectral.json, report.md`);

  return { metrics, spectral, report, hasFailures };
}

function generateReport(metrics, spectral, hasFailures, hasWarnings) {
  const lines = [];
  lines.push('# Audio Quality Test Report');
  lines.push('');
  lines.push(`**Date**: ${new Date().toISOString()}`);
  lines.push(`**Overall**: ${hasFailures ? 'FAIL' : hasWarnings ? 'WARN' : 'PASS'}`);
  lines.push('');

  // ── Summary Table ──
  lines.push('## Signal Quality Summary');
  lines.push('');
  lines.push('| Signal | SNR (dB) | THD (%) | Latency (ms) | Dropouts | Delivery (%) | Verdict |');
  lines.push('|--------|----------|---------|--------------|----------|--------------|---------|');

  for (const [name, m] of Object.entries(metrics.signals)) {
    const snrV = verdict('snr', m.snr_db);
    const thdV = m.thd_pct !== null ? verdict('thd', m.thd_pct) : 'N/A';
    const latV = verdict('latency', m.latency_ms);
    const dropV = verdict('dropouts', m.dropout_count);
    const delV = m.packet_delivery_pct !== null ? verdict('delivery', m.packet_delivery_pct) : 'N/A';

    const verdicts = [snrV, thdV, latV, dropV, delV].filter((v) => v !== 'N/A');
    const worst = verdicts.includes('FAIL') ? 'FAIL' : verdicts.includes('WARN') ? 'WARN' : 'PASS';

    lines.push(
      `| ${name} | ${m.snr_db} (${snrV}) | ${m.thd_pct ?? 'N/A'} ${thdV !== 'N/A' ? `(${thdV})` : ''} | ${m.latency_ms} (${latV}) | ${m.dropout_count} (${dropV}) | ${m.packet_delivery_pct ?? 'N/A'} ${delV !== 'N/A' ? `(${delV})` : ''} | **${worst}** |`
    );
  }

  lines.push('');

  // ── Thresholds ──
  lines.push('## Pass/Fail Thresholds');
  lines.push('');
  lines.push('| Metric | PASS | WARN | FAIL |');
  lines.push('|--------|------|------|------|');
  lines.push('| SNR | > 80 dB | 60-80 dB | < 60 dB |');
  lines.push('| THD | < 0.5% | 0.5-2% | > 2% |');
  lines.push('| Latency | < 100 ms | 100-200 ms | > 200 ms |');
  lines.push('| Dropouts | 0 | 1-3 | > 3 |');
  lines.push('| Delivery | > 99% | 95-99% | < 95% |');
  lines.push('');

  // ── Detailed Analysis ──
  lines.push('## Detailed Analysis');
  lines.push('');

  for (const [name, m] of Object.entries(metrics.signals)) {
    lines.push(`### ${name}`);
    lines.push('');
    lines.push(`- **SNR**: ${m.snr_db} dB — ${snrInterpretation(m.snr_db)}`);
    if (m.thd_pct !== null) {
      lines.push(`- **THD**: ${m.thd_pct}% — ${thdInterpretation(m.thd_pct)}`);
    }
    lines.push(`- **Latency**: ${m.latency_ms} ms — ${latencyInterpretation(m.latency_ms)}`);
    lines.push(`- **Dropouts**: ${m.dropout_count}${m.dropout_count > 0 ? ` (longest: ${Math.max(...m.dropout_details.map(d => d.durationMs)).toFixed(1)}ms)` : ''}`);
    if (m.packet_delivery_pct !== null) {
      lines.push(`- **Packet delivery**: ${m.packet_delivery_pct}% (${m.packet_out_of_order} out-of-order, max gap ${m.packet_max_gap})`);
    }
    lines.push('');
  }

  // ── Load Test ──
  if (metrics.load_test) {
    lines.push('## Load Test Results');
    lines.push('');
    lines.push('| Clients | Delivery (%) | Latency Median (ms) | Latency P95 (ms) |');
    lines.push('|---------|-------------|---------------------|-------------------|');
    for (const [key, value] of Object.entries(metrics.load_test)) {
      if (key === 'scaleCeiling') continue;
      if (value && typeof value === 'object') {
        lines.push(`| ${key.replace('_clients', '')} | ${value.delivery_pct} | ${value.latency_median_ms ?? 'N/A'} | ${value.latency_p95_ms ?? 'N/A'} |`);
      }
    }
    lines.push('');
    if (metrics.load_test.scaleCeiling) {
      lines.push(`**Scale ceiling**: ${metrics.load_test.scaleCeiling} clients (delivery drops below 95%)`);
    } else {
      lines.push('**Scale ceiling**: Not reached — all tested client counts maintained >95% delivery');
    }
    lines.push('');
  }

  // ── VAD Test ──
  if (metrics.vad) {
    lines.push('## VAD Gate Behavior (Old vs New Algorithm)');
    lines.push('');
    lines.push('| Signal | Expected | Old Gate% | New Gate% | Old Score | New Score | Verdict |');
    lines.push('|--------|----------|-----------|-----------|-----------|-----------|---------|');

    for (const [name, data] of Object.entries(metrics.vad)) {
      let oldScore = '', newScore = '', vadVerdict = '';

      if (data.expectGate === 'closed') {
        oldScore = `false=${data.old.falseActivationPct}%`;
        newScore = `false=${data.new.falseActivationPct}%`;
        const improved = data.new.falseActivationPct < data.old.falseActivationPct;
        const pass = data.new.falseActivationPct <= 5;
        vadVerdict = pass ? (improved ? 'PASS (improved)' : 'PASS') : 'FAIL';
      } else if (data.expectGate === 'open') {
        oldScore = `detect=${data.old.detectionPct}%`;
        newScore = `detect=${data.new.detectionPct}%`;
        vadVerdict = data.new.gatePct >= 80 ? 'PASS' : 'FAIL';
      } else {
        oldScore = `TP=${data.old.truePositiveRate}% FP=${data.old.falsePositiveRate}%`;
        newScore = `TP=${data.new.truePositiveRate}% FP=${data.new.falsePositiveRate}%`;
        const improved = data.new.falsePositiveRate < data.old.falsePositiveRate;
        vadVerdict = improved ? 'PASS (improved)' : (data.new.falsePositiveRate <= 30 ? 'PASS' : 'WARN');
      }

      lines.push(
        `| ${name} | ${data.expectGate} | ${data.old.gatePct}% | ${data.new.gatePct}% | ${oldScore} | ${newScore} | **${vadVerdict}** |`
      );
    }
    lines.push('');
    lines.push('**VAD thresholds**: noise-only false activation <5% = PASS, speech detection >80% = PASS');
    lines.push('');
  }

  // ── Spectral Notes ──
  lines.push('## Spectral Analysis Notes');
  lines.push('');
  lines.push('Spectral data available in `spectral.json` for per-frequency-bin analysis.');
  lines.push('Key things to look for:');
  lines.push('- **Rolloff at high frequencies**: Check sweep signal diffDb above 8kHz for >3dB drop');
  lines.push('  - Lowpass filter was removed (was 12kHz) — no rolloff expected now');
  lines.push('- **Noise floor elevation**: Compare noise signal input vs output spectral floor');
  lines.push('- **Quantization noise**: 16-bit PCM quantization adds noise at ~-96dB (theoretical)');
  lines.push('  - Encoding: `client/src/hooks/useVoice.js:621` — `(frame[i] * 32767) | 0`');
  lines.push('  - Decoding: `client/src/hooks/useVoice.js:233` — `int16[i] / 32768`');
  lines.push('  - Note the asymmetry: encode multiplies by 32767, decode divides by 32768');
  lines.push('');

  // ── Recommendations ──
  lines.push('## Recommendations');
  lines.push('');

  const recs = [];
  for (const [name, m] of Object.entries(metrics.signals)) {
    if (m.snr_db < 80) recs.push(`- ${name} SNR (${m.snr_db} dB) below 80 dB threshold. Check for added noise in relay pipeline.`);
    if (m.thd_pct !== null && m.thd_pct > 0.5) recs.push(`- ${name} THD (${m.thd_pct}%) above 0.5%. Check for non-linear distortion in encode/decode.`);
    if (m.latency_ms > 100) recs.push(`- ${name} latency (${m.latency_ms} ms) above 100 ms target. Check server relay path and frame buffering.`);
    if (m.dropout_count > 0) recs.push(`- ${name} has ${m.dropout_count} dropout(s). Check for frame drops in Socket.IO volatile emit (server/index.js:387).`);
    if (m.packet_delivery_pct !== null && m.packet_delivery_pct < 99) {
      recs.push(`- ${name} packet delivery (${m.packet_delivery_pct}%) below 99%. Server volatile.emit may be dropping (server/index.js:387).`);
    }
  }

  if (recs.length === 0) {
    lines.push('All metrics within acceptable thresholds. No immediate action needed.');
  } else {
    lines.push(...recs);
  }

  lines.push('');
  lines.push('---');
  lines.push('*Generated by disclone audio quality test framework*');

  return lines.join('\n');
}

function snrInterpretation(snrDb) {
  if (snrDb > 85) return 'Excellent — near 16-bit PCM ceiling';
  if (snrDb > 80) return 'Good — expected for 16-bit PCM with encode/decode asymmetry';
  if (snrDb > 60) return 'Acceptable — some noise artifacts may be audible';
  return 'Poor — significant noise or signal degradation';
}

function thdInterpretation(thdPct) {
  if (thdPct < 0.1) return 'Excellent — negligible distortion';
  if (thdPct < 0.5) return 'Good — distortion below perceptual threshold';
  if (thdPct < 2) return 'Acceptable — mild distortion present';
  return 'Poor — audible harmonic distortion';
}

function latencyInterpretation(latMs) {
  if (latMs < 50) return 'Excellent — conversational quality';
  if (latMs < 100) return 'Good — acceptable for voice chat';
  if (latMs < 200) return 'Noticeable — some delay perceptible';
  return 'Poor — conversation will feel laggy';
}

// Run directly
if (process.argv[1]?.endsWith('analyze.js')) {
  // Find most recent run directory
  const resultsBase = new URL('./results', import.meta.url).pathname;
  let targetDir = process.argv[2];

  if (!targetDir) {
    const dirs = readdirSync(resultsBase)
      .filter((d) => d.startsWith('run-'))
      .sort()
      .reverse();
    if (dirs.length === 0) {
      console.error('[Analyze] No results found in tests/results/');
      process.exit(1);
    }
    targetDir = `${resultsBase}/${dirs[0]}`;
    console.log(`[Analyze] Using most recent run: ${dirs[0]}`);
  }

  const { report, hasFailures } = analyze(targetDir);
  console.log('\n' + report);
  process.exit(hasFailures ? 1 : 0);
}
