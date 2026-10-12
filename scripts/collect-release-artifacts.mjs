#!/usr/bin/env node
/**
 * Collects the bundle output of one operating system into the flat, space-free
 * file names the download area uses.
 *
 * Each operating system is built on its own runner, so this runs once per
 * runner and writes into a shared `--out` directory. The publish step then sees
 * every platform and generates one manifest from all of them.
 *
 * Names are `mbc-<version>-<channel>-<target>-<arch><suffix>`. They carry no
 * spaces, so their URLs need no escaping, and the suffix keeps the file
 * recognisable to `generate-updater-manifest.cjs` (`.AppImage` -> linux,
 * `.exe` -> windows).
 *
 * Usage:
 *   collect-release-artifacts.mjs --bundle <dir> --out <dir> \
 *     --channel <c> --version <v> --target <linux|windows> [--arch x86_64]
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

/** Longest first: `.AppImage.sig` must not be read as just another suffix. */
export const SUFFIXES = ['.AppImage.sig', '.AppImage', '.exe.sig', '.exe', '.deb', '.rpm'];

/** Bundle subdirectories each target produces. */
export const SOURCE_DIRS = {
  linux: ['appimage', 'deb', 'rpm'],
  windows: ['nsis'],
};

export const artifactName = ({ version, channel, target, arch, suffix }) =>
  `mbc-${version}-${channel}-${target}-${arch}${suffix}`;

/** Bundle files worth publishing, with the suffix that identifies each one. */
export function findArtifacts(bundleRoot, target) {
  const directories = SOURCE_DIRS[target];
  if (!directories) throw new Error(`unknown target: ${target} (expected linux or windows)`);

  const found = [];
  for (const directory of directories) {
    const full = path.join(bundleRoot, directory);
    if (!fs.existsSync(full)) continue;

    for (const entry of fs.readdirSync(full).sort()) {
      const suffix = SUFFIXES.find((candidate) => entry.endsWith(candidate));
      if (!suffix) continue;
      found.push({ source: path.join(full, entry), suffix });
    }
  }
  return found;
}

export function collectReleaseArtifacts({
  bundleRoot,
  outDir,
  version,
  channel,
  target,
  arch = 'x86_64',
}) {
  fs.mkdirSync(outDir, { recursive: true });

  const written = [];
  for (const { source, suffix } of findArtifacts(bundleRoot, target)) {
    const name = artifactName({ version, channel, target, arch, suffix });
    fs.copyFileSync(source, path.join(outDir, name));
    written.push(name);
  }
  return written.sort();
}

const parseArgv = (argv) => {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) throw new Error(`unexpected argument: ${token}`);
    options[token.slice(2)] = argv[i + 1];
    i += 1;
  }
  return options;
};

const required = (options, name) => {
  const value = options[name];
  if (typeof value !== 'string' || value.length === 0) throw new Error(`--${name} is required`);
  return value;
};

export function main(argv = process.argv.slice(2)) {
  const options = parseArgv(argv);
  const target = required(options, 'target');
  const result = {
    target,
    channel: required(options, 'channel'),
    version: required(options, 'version'),
    written: collectReleaseArtifacts({
      bundleRoot: required(options, 'bundle'),
      outDir: options.out ?? 'release-artifacts',
      version: options.version,
      channel: options.channel,
      target,
      arch: options.arch ?? 'x86_64',
    }),
  };

  if (result.written.length === 0) {
    throw new Error(
      `no ${target} bundles found under ${options.bundle}; the build produced nothing to publish`
    );
  }
  return result;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    process.stdout.write(`${JSON.stringify(main(), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`collect-release-artifacts: ${error.message}\n`);
    process.exitCode = 1;
  }
}
