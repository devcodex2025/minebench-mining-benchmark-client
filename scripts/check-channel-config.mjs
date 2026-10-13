#!/usr/bin/env node
/**
 * Fails a build whose infrastructure endpoints do not match its channel.
 *
 * The requirement is strict and asymmetric:
 *
 *   nightly          must NOT reach production infrastructure
 *   canary, stable   must ONLY reach production infrastructure
 *
 * It matters because the endpoints are compile-time: a client built with the
 * wrong ones silently talks to the wrong cluster, and nothing at runtime would
 * notice. Stable and canary are safe when a variable is unset, because the code
 * falls back to compiled production defaults; nightly is not, because those same
 * defaults are production.
 *
 * Usage:
 *   node scripts/check-channel-config.mjs <stable|canary|nightly> [cwd]
 *
 * Prints `{ ok, channel, violations }` and exits 1 on any violation.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import dotenv from 'dotenv';

export const CHANNELS = ['stable', 'canary', 'nightly'];

/**
 * Variables that describe the channel's infrastructure, and what "production"
 * means for each.
 */
export const REQUIRED_VARIABLES = {
  VITE_API_BASE_URL: 'minebench',
  VITE_BACKEND_URL: 'minebench',
  VITE_PRIMARY_POOL_HOST: 'minebench',
  VITE_PRIMARY_RPC_HOST: 'minebench',
  VITE_SOLANA_RPC_URL: 'solana',
};

const PRODUCTION_DOMAIN = 'minebench.cloud';
const SOLANA_MAINNET_HOST = 'api.mainnet-beta.solana.com';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1']);

/** Host part of a URL, a `host:port` pair, or a bare host. */
export function hostOf(value) {
  return String(value)
    .trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
    .replace(/^[^@/]*@/, '')
    .split(/[/?#]/)[0]
    .split(':')[0]
    .toLowerCase();
}

export const isProductionHost = (host) =>
  host === PRODUCTION_DOMAIN || host.endsWith(`.${PRODUCTION_DOMAIN}`);

/** `production`, `local` or `test`, from the point of view of one variable. */
export const classifyHost = (kind, host) => {
  if (kind === 'solana') return host === SOLANA_MAINNET_HOST ? 'production' : 'test';
  if (isProductionHost(host)) return 'production';
  if (LOCAL_HOSTS.has(host)) return 'local';
  return 'test';
};

export function evaluateChannelConfig(channel, env) {
  if (!CHANNELS.includes(channel)) throw new Error(`unknown channel: ${channel}`);

  const violations = [];
  for (const [variable, kind] of Object.entries(REQUIRED_VARIABLES)) {
    const raw = env[variable];
    const value = typeof raw === 'string' ? raw.trim() : '';

    if (value.length === 0) {
      if (channel === 'nightly') {
        violations.push({
          variable,
          value: '(unset)',
          problem: 'a nightly build must be given explicit test endpoints',
        });
      }
      continue;
    }

    const host = hostOf(value);
    const kindOfEndpoint = classifyHost(kind, host);

    if (channel === 'nightly') {
      if (kindOfEndpoint === 'production') {
        violations.push({
          variable,
          value,
          problem: 'a nightly build must not use production infrastructure',
        });
      }
    } else if (kindOfEndpoint === 'local') {
      violations.push({
        variable,
        value,
        problem: `a ${channel} build must not use a local endpoint`,
      });
    } else if (kindOfEndpoint === 'test') {
      violations.push({
        variable,
        value,
        problem: `a ${channel} build must use production infrastructure`,
      });
    }
  }

  return { ok: violations.length === 0, channel, violations };
}

/**
 * The environment a Vite build for this channel would see: the same file
 * precedence, with the process environment winning (that is how CI injects it).
 */
export function loadEnvironment(channel, cwd = process.cwd()) {
  const files = ['.env', '.env.local', `.env.${channel}`, `.env.${channel}.local`];
  const fromFiles = {};
  for (const file of files) {
    const target = path.join(cwd, file);
    if (!fs.existsSync(target)) continue;
    Object.assign(fromFiles, dotenv.parse(fs.readFileSync(target)));
  }

  const fromProcess = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('VITE_')) fromProcess[key] = value;
  }

  return { ...fromFiles, ...fromProcess };
}

export function main(argv = process.argv.slice(2)) {
  const [channel, cwd] = argv.filter((token) => !token.startsWith('-'));
  if (!channel) {
    throw new Error('usage: check-channel-config.mjs <stable|canary|nightly> [cwd]');
  }
  return evaluateChannelConfig(channel, loadEnvironment(channel, cwd ?? process.cwd()));
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const result = main();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`check-channel-config: ${error.message}\n`);
    process.exitCode = 1;
  }
}
