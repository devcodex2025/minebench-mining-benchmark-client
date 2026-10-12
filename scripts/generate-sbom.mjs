#!/usr/bin/env node
/**
 * Builds the release SBOM (CycloneDX 1.5) from what the build already has.
 *
 * Both ecosystems are read from their lock data rather than from an installed
 * tree, so the publish step needs neither `npm ci` nor network access, and the
 * result describes exactly what the lock file pins.
 *
 * Deterministic by design: components are sorted and no timestamps or random ids
 * are added, so two builds of the same commit produce the same document.
 *
 * Usage:
 *   generate-sbom.mjs [--version <v>] [--out <file>] [--product <name>]
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const SBOM_FORMAT = 'CycloneDX';
export const SBOM_SPEC_VERSION = '1.5';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Components pinned by `package-lock.json` (lockfileVersion 2 and 3). */
export function componentsFromLockfile(lock) {
  const packages = lock?.packages ?? {};

  return Object.entries(packages)
    // The empty key is the project itself, not a dependency.
    .filter(([location]) => location !== '')
    .map(([location, entry]) => {
      const name = entry?.name ?? location.replace(/^.*node_modules\//, '');
      const version = entry?.version;
      if (!name || !version) return null;

      // Dev dependencies never reach the shipped bundle, so they are recorded as
      // excluded rather than silently dropped.
      const scope = entry.dev === true ? 'excluded' : entry.optional === true ? 'optional' : 'required';

      return { type: 'library', name, version, scope, purl: `pkg:npm/${name}@${version}` };
    })
    .filter(Boolean);
}

/** Registry crates from `cargo metadata`. Path packages are our own workspace. */
export function componentsFromCargoMetadata(metadata) {
  return (metadata?.packages ?? [])
    .filter((entry) => typeof entry?.source === 'string' && entry.source.length > 0)
    .map((entry) => ({
      type: 'library',
      name: entry.name,
      version: entry.version,
      scope: 'required',
      purl: `pkg:cargo/${entry.name}@${entry.version}`,
    }))
    .filter((entry) => entry.name && entry.version);
}

export function buildSbom({ lock, metadata, version, product = 'MineBench Client' }) {
  const byPurl = new Map();
  for (const component of [
    ...componentsFromLockfile(lock),
    ...componentsFromCargoMetadata(metadata),
  ]) {
    // The same package can legitimately appear in both ecosystems only with
    // different purls; identical purls collapse.
    if (!byPurl.has(component.purl)) byPurl.set(component.purl, component);
  }

  return {
    bomFormat: SBOM_FORMAT,
    specVersion: SBOM_SPEC_VERSION,
    version: 1,
    metadata: {
      component: {
        type: 'application',
        name: product,
        version,
      },
    },
    components: [...byPurl.values()].sort((left, right) => left.purl.localeCompare(right.purl)),
  };
}

const parseArgv = (argv) => {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) throw new Error(`unexpected argument: ${argv[i]}`);
    options[argv[i].slice(2)] = argv[i + 1];
    i += 1;
  }
  return options;
};

export function main(argv = process.argv.slice(2)) {
  const options = parseArgv(argv);
  const version = options.version ?? JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).version;
  const out = options.out ?? path.join('release-artifacts', `sbom-${version}.json`);

  const lock = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package-lock.json'), 'utf8'));
  const metadata = JSON.parse(
    execFileSync(
      'cargo',
      ['metadata', '--format-version', '1', '--locked', '--manifest-path', path.join(repoRoot, 'src-tauri', 'Cargo.toml')],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
    )
  );

  const sbom = buildSbom({ lock, metadata, version, product: options.product });
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(sbom, null, 2)}\n`);

  return { out, version, components: sbom.components.length };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    process.stdout.write(`${JSON.stringify(main(), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`generate-sbom: ${error.message}\n`);
    process.exitCode = 1;
  }
}
