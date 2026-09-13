import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildWarmupPresets,
  runBenchmarkWarmup,
  type WarmupPreset,
} from './benchmark-warmup.ts';

const preset = (id: string): WarmupPreset => ({
  id,
  label: id,
  threads: 1,
  cpuPriority: 2,
  randomxMode: 'fast',
  hugePages: true,
});

function clock() {
  let time = 0;
  return {
    now: () => time,
    wait: async (ms: number) => { time += ms; },
  };
}

test('buildWarmupPresets bounds threads and removes duplicate candidates', () => {
  assert.deepEqual(buildWarmupPresets(1, false).map(({ threads }) => threads), [1]);
  assert.deepEqual(buildWarmupPresets(2, false).map(({ threads }) => threads), [1, 2]);
  assert.deepEqual(buildWarmupPresets(0, true).map(({ threads }) => threads), [1]);
  assert.deepEqual(buildWarmupPresets(Number.NaN, false).map(({ threads }) => threads), [1]);
});

test('chooses the fastest stable preset and restarts it when it was measured earlier', async () => {
  const timers = clock();
  const presets = [preset('first'), preset('faster'), preset('last')];
  const rates: Record<string, number> = { first: 100, faster: 250, last: 150 };
  const starts: string[] = [];
  let active = '';
  const result = await runBenchmarkWarmup({
    presets,
    signal: new AbortController().signal,
    start: async (candidate) => { active = candidate.id; starts.push(candidate.id); },
    sample: () => ({ hashrate: rates[active], sampledAt: timers.now() }),
    progress: () => undefined,
    now: timers.now,
    wait: timers.wait,
  });

  assert.equal(result.preset.id, 'faster');
  assert.equal(result.hashrate, 250);
  assert.ok(result.samples >= 3);
  assert.deepEqual(starts, ['first', 'faster', 'last', 'faster']);
});

test('restarts the previous winner when a later preset fails to start', async () => {
  const timers = clock();
  const first = preset('first');
  const failed = preset('failed');
  const starts: string[] = [];
  let active = '';
  const result = await runBenchmarkWarmup({
    presets: [first, failed],
    signal: new AbortController().signal,
    start: async (candidate) => {
      starts.push(candidate.id);
      if (candidate.id === failed.id) throw new Error('miner launch failed');
      active = candidate.id;
    },
    sample: () => ({ hashrate: active === first.id ? 100 : 0, sampledAt: timers.now() }),
    progress: () => undefined,
    now: timers.now,
    wait: timers.wait,
  });

  assert.equal(result.preset.id, first.id);
  assert.deepEqual(starts, ['first', 'failed', 'first']);
});

test('rejects a run whose fresh samples never reach the stability threshold', async () => {
  const timers = clock();
  let active = false;
  await assert.rejects(runBenchmarkWarmup({
    presets: [preset('only')],
    signal: new AbortController().signal,
    start: async () => { active = true; },
    sample: () => active && timers.now() <= 16_000
      ? { hashrate: 100, sampledAt: timers.now() }
      : { hashrate: 100, sampledAt: timers.now() - 10_000 },
    progress: () => undefined,
    now: timers.now,
    wait: timers.wait,
  }), /no preset produced enough hashrate samples/i);
});

test('does not launch a preset after an aborted start or aborted sampling', async () => {
  const beforeStart = new AbortController();
  beforeStart.abort(new Error('cancelled'));
  let starts = 0;
  await assert.rejects(runBenchmarkWarmup({
    presets: [preset('first'), preset('second')],
    signal: beforeStart.signal,
    start: async () => { starts++; },
    sample: () => null,
    progress: () => undefined,
  }));
  assert.equal(starts, 0);

  const whileStarting = new AbortController();
  const started: string[] = [];
  let resolveStart!: () => void;
  const starting = runBenchmarkWarmup({
    presets: [preset('first'), preset('second')],
    signal: whileStarting.signal,
    start: async (candidate) => {
      started.push(candidate.id);
      await new Promise<void>((resolve) => { resolveStart = resolve; });
    },
    sample: () => null,
    progress: () => undefined,
  });
  whileStarting.abort(new Error('cancelled'));
  resolveStart();
  await assert.rejects(starting);
  assert.deepEqual(started, ['first']);

  const timers = clock();
  const duringSampling = new AbortController();
  const launched: string[] = [];
  await assert.rejects(runBenchmarkWarmup({
    presets: [preset('first'), preset('second')],
    signal: duringSampling.signal,
    start: async (candidate) => { launched.push(candidate.id); },
    sample: () => ({ hashrate: 100, sampledAt: timers.now() }),
    progress: () => undefined,
    now: timers.now,
    wait: async (ms) => {
      await timers.wait(ms);
      duringSampling.abort(new Error('cancelled'));
    },
  }));
  assert.deepEqual(launched, ['first']);
});
