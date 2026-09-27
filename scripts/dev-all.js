#!/usr/bin/env node

/**
 * Development launcher with environment mode support
 * Usage: npm run dev:all [production|development]
 */

import { execSync } from 'child_process';
import path from 'path';

const mode = process.argv[2] || 'development';

if (!['production', 'development'].includes(mode)) {
  console.error(`❌ Invalid mode: ${mode}. Use 'production' or 'development'`);
  process.exit(1);
}

const viteMode = mode === 'production' ? 'production' : 'development';
const devCommand = mode === 'production' ? 'npm run dev:prod' : 'npm run dev:local';

console.log(`\n🚀 Starting development environment (${mode.toUpperCase()})...`);
console.log(`   Vite: ${viteMode}`);
console.log(`   Electron: enabled\n`);

// Pass mode to Electron via environment variable
const env = { ...process.env, MINEBENCH_MODE: mode };

try {
  // Use concurrently to run both vite and electron
  execSync(`concurrently "${devCommand}" "wait-on http://localhost:5173 && npm run electron"`, {
    stdio: 'inherit',
    shell: true,
    env
  });
} catch (err) {
  process.exit(1);
}
