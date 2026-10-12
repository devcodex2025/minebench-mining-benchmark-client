#!/usr/bin/env node
/**
 * Channel pool management for the MineBench client.
 *
 * `.release/channels.json` is the single source of truth for what each channel
 * offers; this script is the only writer. It keeps the pools to their rules,
 * renders the manifest files the client reads, and reports which files a
 * pipeline must delete so a version that left a pool cannot be installed any
 * more.
 *
 * Pools (see `.release/README.md`):
 *
 *   nightly  the newest build from `main` only  -> 1 version
 *   canary   every version newer than the newest stable
 *   stable   the newest versions                -> 3 versions
 *
 * A version outside a pool is revoked by definition; `revoked` additionally
 * records explicit revocations, which stay listed so the client can explain why
 * the version it is running is no longer offered.
 *
 * Usage:
 *   channel.mjs publish --channel <c> --version <v> --manifest <file> [--out <dir>]
 *                       [--commit <sha>] [--by <who>] [--notes "..."]
 *   channel.mjs revoke  --version <v> --reason "..." [--channel <c>] [--by <who>]
 *                       [--out <dir>]
 *   channel.mjs render  [--out <dir>]
 *   channel.mjs status
 *
 * `publish` and `revoke` print `{ "written": [...], "delete": [...] }`.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const SCHEMA_VERSION = 1;
export const STATE_PATH = '.release/channels.json';
export const DEFAULT_OUT_DIR = 'release-artifacts';
export const LEGACY_MANIFEST_NAME = 'latest.json';

/** Channels in `channels.json`, and how many versions each pool keeps. */
export const CHANNELS = ['nightly', 'canary', 'stable'];
export const POOL_LIMITS = { nightly: 1, canary: Number.POSITIVE_INFINITY, stable: 3 };

/**
 * Version shapes. `publish` refuses a mismatch, so a release candidate can
 * never land in `stable` and a stable version can never land in `canary`.
 */
export const VERSION_PATTERNS = {
  nightly: /^\d+\.\d+\.\d+-nightly\.\d{8}\.\d+$/,
  canary: /^\d+\.\d+\.\d+-canary\.\d+$/,
  stable: /^\d+\.\d+\.\d+$/,
};

const parseVersion = (version) => {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
    String(version).trim()
  );
  if (!match) throw new Error(`not a semantic version: ${version}`);
  return {
    numbers: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ? match[4].split('.') : [],
  };
};

/**
 * Semantic Versioning 2.0.0 precedence. Build metadata is ignored, a prerelease
 * ranks below its release, and alphanumeric identifiers rank above numeric ones.
 */
export function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);

  for (let i = 0; i < 3; i += 1) {
    if (a.numbers[i] !== b.numbers[i]) return a.numbers[i] < b.numbers[i] ? -1 : 1;
  }
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0;
  if (a.prerelease.length === 0) return 1;
  if (b.prerelease.length === 0) return -1;

  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let i = 0; i < length; i += 1) {
    const x = a.prerelease[i];
    const y = b.prerelease[i];
    if (x === undefined) return -1; // a shorter set has lower precedence
    if (y === undefined) return 1;
    const numeric = /^\d+$/.test(x);
    if (numeric !== /^\d+$/.test(y)) return numeric ? -1 : 1;
    if (numeric) {
      const xn = Number(x);
      const yn = Number(y);
      if (xn !== yn) return xn < yn ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

export function assertChannelVersion(channel, version) {
  const pattern = VERSION_PATTERNS[channel];
  if (!pattern) throw new Error(`unknown channel: ${channel}`);
  if (!pattern.test(String(version).trim())) {
    throw new Error(`${version} is not a valid ${channel} version (expected ${pattern})`);
  }
}

export const manifestFileName = (channel, version) => `manifest-${channel}-${version}.json`;
export const poolFileName = (channel) => `${channel}-versions.json`;
export const revokedFileName = (channel) => `${channel}-revoked.json`;
export const latestFileName = (channel) => `${channel}-latest.json`;

/** `YYYYMMDD`, the date component of a nightly version. */
export const versionDate = (now = new Date()) => now.toISOString().slice(0, 10).replace(/-/g, '');

/** Artifact file names a Tauri manifest points at. */
export function artifactsOf(manifest) {
  const names = new Set();
  for (const platform of Object.values(manifest?.platforms ?? {})) {
    if (!platform?.url) continue;

    // Decode before taking the base name: a url ending in `%2e%2e%2f` would
    // otherwise keep its separators and end up as a path in the shell, where these
    // names are used to upload and delete files.
    const name = path.basename(decodeURIComponent(String(platform.url)));
    if (!/^[A-Za-z0-9._-]+$/.test(name) || name.startsWith('.')) continue;
    names.add(name);
  }
  return [...names].sort();
}

export function emptyState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    channels: { nightly: [], canary: [], stable: [] },
    revoked: [],
    /** Per-channel kill switch: versions below `minVersion` must not run. */
    killSwitches: {},
  };
}

export function loadState(file = STATE_PATH) {
  if (!fs.existsSync(file)) return emptyState();
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const channel of CHANNELS) {
    if (!Array.isArray(state.channels?.[channel])) {
      throw new Error(`${file}: channels.${channel} must be an array`);
    }
  }
  if (!Array.isArray(state.revoked)) throw new Error(`${file}: revoked must be an array`);
  return state;
}

export function saveState(state, file = STATE_PATH) {
  const resolved = path.resolve(file);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(state, null, 2)}\n`);
}

/** Newest first, with duplicate versions collapsed. */
const sortedPool = (entries) =>
  [...(entries ?? [])]
    .sort((a, b) => compareVersions(b.version, a.version))
    .filter((entry, index, all) => all.findIndex((other) => other.version === entry.version) === index);

/**
 * Applies the pool rules and reports which versions left a pool, so the caller
 * can delete their artifacts.
 */
export function prunePools(state) {
  const revoked = new Set(state.revoked.map((entry) => entry.version));
  const keep = { nightly: [], canary: [], stable: [] };
  const removed = new Map();
  const drop = (channel, entry) => {
    if (!removed.has(entry.version)) removed.set(entry.version, { channel, entry });
  };

  for (const entry of sortedPool(state.channels.stable)) {
    if (revoked.has(entry.version)) {
      drop('stable', entry);
    } else if (keep.stable.length < POOL_LIMITS.stable) {
      keep.stable.push(entry);
    } else {
      drop('stable', entry);
    }
  }
  const latestStable = keep.stable[0]?.version ?? null;

  for (const entry of sortedPool(state.channels.canary)) {
    if (revoked.has(entry.version)) {
      drop('canary', entry);
    } else if (latestStable === null || compareVersions(entry.version, latestStable) > 0) {
      keep.canary.push(entry);
    } else {
      // Publishing a stable release retires the candidates it supersedes.
      drop('canary', entry);
    }
  }

  for (const entry of sortedPool(state.channels.nightly)) {
    if (revoked.has(entry.version)) {
      drop('nightly', entry);
    } else if (keep.nightly.length < POOL_LIMITS.nightly) {
      keep.nightly.push(entry);
    } else {
      drop('nightly', entry);
    }
  }

  return { state: { ...state, channels: keep }, removed: [...removed.values()] };
}

const revokedView = (entry) => ({
  version: entry.version,
  reason: entry.reason ?? null,
  at: entry.at ?? null,
  by: entry.by ?? null,
});

/**
 * A kill switch stops versions below `minVersion` from being installed or run.
 * It is deliberately separate from the pool: clearing it re-enables those
 * versions, while a revocation is permanent.
 */
const killSwitchView = (entry) =>
  entry
    ? {
        minVersion: entry.minVersion,
        message: entry.message ?? null,
        block: entry.block === true,
      }
    : null;

export const killSwitchFor = (state, channel) =>
  killSwitchView(state.killSwitches?.[channel]);

const appliesTo = (entry, channel) => !entry.channel || entry.channel === channel;

/**
 * Renders every manifest file the client reads. Pure: the plan is returned, and
 * `writePlan` is what touches the filesystem.
 *
 * `latest.json` (no channel prefix) is the endpoint every pre-0.9 client is
 * compiled with, so it must keep pointing at the newest stable version.
 */
export function planRender(state) {
  const generatedAt = new Date().toISOString();
  const files = new Map();
  // Pointers that must not exist, because the pool behind them is empty. A
  // stale pointer would let a client install a version that left the pool.
  const obsolete = new Set();

  for (const channel of CHANNELS) {
    const pool = state.channels[channel] ?? [];
    for (const entry of pool) {
      if (entry.manifest) files.set(manifestFileName(channel, entry.version), entry.manifest);
    }

    if (pool.length === 0) obsolete.add(latestFileName(channel));

    const revoked = state.revoked.filter((entry) => appliesTo(entry, channel));

    files.set(poolFileName(channel), {
      schemaVersion: SCHEMA_VERSION,
      channel,
      generatedAt,
      latest: pool[0]?.version ?? null,
      // A kill switch gates installing, including a rollback; it never silently
      // removes a version from the pool.
      killSwitch: killSwitchFor(state, channel),
      versions: pool.map((entry) => ({
        version: entry.version,
        publishedAt: entry.publishedAt ?? null,
        commit: entry.commit ?? null,
        notes: entry.notes ?? null,
        manifest: manifestFileName(channel, entry.version),
        artifacts: entry.artifacts ?? artifactsOf(entry.manifest),
      })),
      revoked: revoked.map(revokedView),
    });

    files.set(revokedFileName(channel), {
      schemaVersion: SCHEMA_VERSION,
      channel,
      generatedAt,
      revoked: revoked.map(revokedView),
    });

    if (pool[0]?.manifest) files.set(latestFileName(channel), pool[0].manifest);
  }

  const newestStable = (state.channels.stable ?? [])[0];
  if (newestStable?.manifest) files.set(LEGACY_MANIFEST_NAME, newestStable.manifest);
  else obsolete.add(LEGACY_MANIFEST_NAME);

  return { generatedAt, files, obsolete };
}

export function writePlan(plan, outDir = DEFAULT_OUT_DIR) {
  fs.mkdirSync(outDir, { recursive: true });
  const written = [];
  for (const [name, content] of plan.files) {
    fs.writeFileSync(path.join(outDir, name), `${JSON.stringify(content, null, 2)}\n`);
    written.push(name);
  }
  return written.sort();
}

/**
 * Everything a release should upload: the files this run rendered, plus the build
 * artifacts that were collected into the directory beforehand. Files that left a
 * pool are excluded, so uploading the whole set can never resurrect a version.
 */
export function collectPublishable(outDir, rendered, deleted = []) {
  const excluded = new Set(deleted);
  const present = fs.existsSync(outDir)
    ? fs
        .readdirSync(outDir)
        .filter((name) => !excluded.has(name) && fs.statSync(path.join(outDir, name)).isFile())
    : [];

  return [...new Set([...rendered, ...present])].filter((name) => !excluded.has(name)).sort();
}

/**
 * Drops files the pipeline must not publish any more from the output directory,
 * so uploading everything the directory contains can never resurrect a version
 * that left a pool.
 */
export function removeFiles(outDir, names) {
  const removed = [];
  for (const name of names) {
    const target = path.join(outDir, name);
    if (!fs.existsSync(target)) continue;
    fs.rmSync(target, { force: true });
    removed.push(name);
  }
  return removed.sort();
}

/**
 * Files that must be gone from the output directory: everything a version left
 * behind when it exited a pool, plus pointers to pools that are now empty. Names
 * the current render wrote are never included.
 */
function staleNames(plan, deleted, written) {
  const stale = new Set([...deleted, ...plan.obsolete]);
  for (const name of written) stale.delete(name);
  return [...stale].sort();
}

/**
 * Files a pipeline must remove from the downloads area: the per-version manifest
 * of every version that left a pool, plus its artifacts and their signatures.
 */
export function deleteList(removed) {
  const names = new Set();
  for (const { channel, entry } of removed) {
    names.add(manifestFileName(channel, entry.version));
    for (const artifact of entry.artifacts ?? artifactsOf(entry.manifest)) {
      names.add(artifact);
      names.add(`${artifact}.sig`);
    }
  }
  return [...names].sort();
}

export function publish(state, { channel, version, manifest, commit, by, notes }) {
  assertChannelVersion(channel, version);
  if (String(manifest?.version) !== String(version)) {
    throw new Error(`manifest version ${manifest?.version} does not match ${version}`);
  }

  const entry = {
    version,
    publishedAt: manifest.pub_date ?? new Date().toISOString(),
    commit: commit ?? null,
    by: by ?? null,
    notes: notes ?? manifest.notes ?? null,
    artifacts: artifactsOf(manifest),
    manifest,
  };

  const withNewVersion = {
    ...state,
    channels: {
      ...state.channels,
      [channel]: [...state.channels[channel].filter((item) => item.version !== version), entry],
    },
  };

  const pruned = prunePools(withNewVersion);
  return { state: pruned.state, removed: pruned.removed };
}

export function revoke(state, { version, channel, reason, by }) {
  if (!reason) throw new Error('a revocation needs a reason');
  if (!channel && !CHANNELS.some((c) => state.channels[c].some((e) => e.version === version))) {
    throw new Error(`${version} is in no pool; revoke it only if it must be blocked explicitly`);
  }

  const revocation = {
    version,
    channel: channel ?? null,
    reason,
    at: new Date().toISOString(),
    by: by ?? null,
  };
  const alreadyRevoked = state.revoked.some((entry) => entry.version === version);

  return prunePools({
    ...state,
    revoked: alreadyRevoked ? state.revoked : [...state.revoked, revocation],
  });
}

/**
 * Channel a CI ref belongs to. `main` is nightly; a tag says it itself, so a
 * release candidate can never be built as stable.
 */
export function channelForRef({ branch, tag } = {}) {
  if (tag) {
    const version = String(tag).replace(/^v/, '');
    for (const channel of CHANNELS) {
      if (VERSION_PATTERNS[channel].test(version)) return channel;
    }
    throw new Error(`tag ${tag} does not match any channel version format`);
  }
  if (branch === 'main') return 'nightly';
  throw new Error(`cannot tell the channel for ref ${JSON.stringify({ branch, tag })}`);
}

const bumpPatch = (version) => {
  const { numbers } = parseVersion(version);
  return `${numbers[0]}.${numbers[1]}.${numbers[2] + 1}`;
};

/**
 * Version for the next nightly build: one patch above the newest stable, with
 * the date and a counter that restarts when the base version moves.
 */
export function nextNightlyVersion(state, { date = versionDate(), fallback } = {}) {
  const last = state.channels.nightly[0];
  const latestStable = state.channels.stable[0]?.version ?? null;

  let base = null;
  let counter = 1;
  if (last) {
    const parsed = parseVersion(last.version);
    base = `${parsed.numbers[0]}.${parsed.numbers[1]}.${parsed.numbers[2]}`;
    if (parsed.prerelease[1] === date) counter = Number(parsed.prerelease[2]) + 1;
  }
  if (latestStable && (base === null || compareVersions(base, latestStable) <= 0)) {
    base = bumpPatch(latestStable);
    counter = 1;
  }
  if (base === null) {
    if (!fallback) throw new Error('no stable or nightly version to build on; pass --fallback');
    base = bumpPatch(fallback);
  }
  return `${base}-nightly.${date}.${counter}`;
}

/**
 * What a CI run should build. Explicit `MINEBENCH_CHANNEL` / `MINEBENCH_VERSION`
 * win, so a manual re-run can name them; otherwise they come from the ref.
 */
export function resolveBuild(env, state) {
  const channel = env.MINEBENCH_CHANNEL || channelForRef({ branch: env.BITBUCKET_BRANCH, tag: env.BITBUCKET_TAG });
  const version = (
    env.MINEBENCH_VERSION ||
    (channel === 'nightly'
      ? nextNightlyVersion(state, { date: env.MINEBENCH_DATE || versionDate(), fallback: env.MINEBENCH_FALLBACK })
      : String(env.BITBUCKET_TAG ?? ''))
  ).replace(/^v/, '');

  assertChannelVersion(channel, version);
  return { channel, version };
}

/** Arms, or updates, the kill switch of one channel. */
export function applyKillSwitch(state, { channel, minVersion, message, by, block }) {
  if (!CHANNELS.includes(channel)) throw new Error(`unknown channel: ${channel}`);
  assertChannelVersion(channel, minVersion);

  return {
    ...state,
    killSwitches: {
      ...(state.killSwitches ?? {}),
      [channel]: {
        minVersion,
        message: message ?? null,
        block: block === true,
        setAt: new Date().toISOString(),
        by: by ?? null,
      },
    },
  };
}

/** Disarms the kill switch of one channel, re-enabling the versions it gated. */
export function clearKillSwitch(state, { channel }) {
  if (!CHANNELS.includes(channel)) throw new Error(`unknown channel: ${channel}`);
  const killSwitches = { ...(state.killSwitches ?? {}) };
  delete killSwitches[channel];
  return { ...state, killSwitches };
}

const requireOption = (options, name) => {
  const value = options[name];
  if (typeof value !== 'string' || value.length === 0) throw new Error(`--${name} is required`);
  return value;
};

/** Optionally mirrors the CLI result to a file the pipeline can read afterwards. */
const withReport = (options, result) => {
  if (typeof options.report === 'string') {
    const target = path.resolve(options.report);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${JSON.stringify(result, null, 2)}\n`);
  }
  return result;
};

const parseArgv = (argv) => {
  const [command, ...rest] = argv;
  const options = {};
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token.startsWith('--')) throw new Error(`unexpected argument: ${token}`);
    const key = token.slice(2);
    const value = rest[i + 1];
    if (value === undefined || (value.startsWith('--') && value.length > 2)) {
      options[key] = true;
    } else {
      options[key] = value;
      i += 1;
    }
  }
  return { command, options };
};

const runPublish = (options) => {
  const statePath = options.state ?? STATE_PATH;
  const out = options.out ?? DEFAULT_OUT_DIR;
  const version = requireOption(options, 'version');
  const channel = requireOption(options, 'channel');
  const manifest = JSON.parse(fs.readFileSync(requireOption(options, 'manifest'), 'utf8'));

  const result = publish(loadState(statePath), {
    channel,
    version,
    manifest,
    commit: options.commit,
    by: options.by,
    notes: options.notes,
  });

  const deleted = deleteList(result.removed);
  const plan = planRender(result.state);
  const written = writePlan(plan, out);
  const removedLocally = removeFiles(out, staleNames(plan, deleted, written));
  saveState(result.state, statePath);
  return withReport(options, {
    state: statePath,
    channel,
    version,
    // The installers were collected into `out` before this ran, so they are part
    // of the publish set even though this run did not create them.
    publish: collectPublishable(out, written, deleted),
    written,
    delete: deleted,
    removedLocally,
  });
};

const runRevoke = (options) => {
  const statePath = options.state ?? STATE_PATH;
  const out = options.out ?? DEFAULT_OUT_DIR;
  const version = requireOption(options, 'version');
  const result = revoke(loadState(statePath), {
    version,
    reason: requireOption(options, 'reason'),
    channel: typeof options.channel === 'string' ? options.channel : null,
    by: options.by,
  });

  const deleted = deleteList(result.removed);
  const plan = planRender(result.state);
  const written = writePlan(plan, out);
  const removedLocally = removeFiles(out, staleNames(plan, deleted, written));
  saveState(result.state, statePath);
  return withReport(options, {
    state: statePath,
    revoked: version,
    publish: collectPublishable(out, written, deleted),
    written,
    delete: deleted,
    removedLocally,
  });
};

const runRender = (options) => {
  const statePath = options.state ?? STATE_PATH;
  const out = options.out ?? DEFAULT_OUT_DIR;
  return { state: statePath, written: writePlan(planRender(loadState(statePath)), out) };
};

const runStatus = (options) => {
  const state = loadState(options.state ?? STATE_PATH);
  return {
    pools: Object.fromEntries(CHANNELS.map((c) => [c, state.channels[c].map((e) => e.version)])),
    revoked: state.revoked.map((e) => e.version),
  };
};

/** `package.json` version, used to bootstrap a channel that has no history yet. */
export function packageVersion(file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json')) {
  return JSON.parse(fs.readFileSync(file, 'utf8')).version;
}

const runKillSwitch = (options) => {
  const statePath = options.state ?? STATE_PATH;
  const out = options.out ?? DEFAULT_OUT_DIR;
  const channel = requireOption(options, 'channel');

  const updated =
    options.clear === true
      ? clearKillSwitch(loadState(statePath), { channel })
      : applyKillSwitch(loadState(statePath), {
          channel,
          minVersion: requireOption(options, 'min-version'),
          // A pipeline passes these as variables, which arrive as environment
          // variables: taking them from there avoids pushing free text through a
          // shell.
          message:
            typeof options.message === 'string'
              ? options.message
              : process.env.MINEBENCH_KILL_MESSAGE,
          by: options.by ?? process.env.BITBUCKET_STEP_TRIGGERER_UUID,
          block: options.block === true || process.env.MINEBENCH_KILL_BLOCK === '1',
        });

  // A kill switch changes what may be installed, so the pool is republished.
  const written = writePlan(planRender(updated), out);
  saveState(updated, statePath);

  return withReport(options, {
    state: statePath,
    channel,
    publish: collectPublishable(out, written, []),
    written,
    delete: [],
    removedLocally: [],
    killSwitch: killSwitchFor(updated, channel),
  });
};

const runResolveBuild = (options) =>
  resolveBuild(
    {
      MINEBENCH_CHANNEL: typeof options.channel === 'string' ? options.channel : undefined,
      MINEBENCH_VERSION: typeof options.version === 'string' ? options.version : undefined,
      MINEBENCH_DATE: typeof options.date === 'string' ? options.date : undefined,
      MINEBENCH_FALLBACK: typeof options.fallback === 'string' ? options.fallback : packageVersion(),
      BITBUCKET_BRANCH: process.env.BITBUCKET_BRANCH,
      BITBUCKET_TAG: process.env.BITBUCKET_TAG,
    },
    loadState(options.state ?? STATE_PATH)
  );

export function main(argv = process.argv.slice(2)) {
  const { command, options } = parseArgv(argv);
  switch (command) {
    case 'publish':
      return runPublish(options);
    case 'revoke':
      return runRevoke(options);
    case 'render':
      return runRender(options);
    case 'status':
      return runStatus(options);
    case 'kill-switch':
      return runKillSwitch(options);
    case 'resolve-build':
      return runResolveBuild(options);
    default:
      throw new Error(
        `unknown command: ${command ?? '(none)'} (expected publish, revoke, render, kill-switch, status or resolve-build)`
      );
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const result = main();
    if (process.argv[2] === 'resolve-build' && !process.argv.includes('--json')) {
      // Shell assignments, so a bash pipeline can `eval "$(...)"` them.
      process.stdout.write(`CHANNEL=${result.channel}\nVERSION=${result.version}\n`);
    } else {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    }
  } catch (error) {
    process.stderr.write(`channel: ${error.message}\n`);
    process.exitCode = 1;
  }
}
