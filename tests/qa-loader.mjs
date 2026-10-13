// QA test loader for MineBench-Client (test tooling only — no production code).
//
// Node's ESM resolver requires file extensions and an import attribute for JSON, while the Client's
// source uses extensionless relative imports (`import { x } from '../config/environment'`) and JSON
// imports (`import fallbackConfig from '../../config/fallback.json'`). Vite resolves both in the real
// app, so the audit reproduces that resolution here instead of touching the source:
//   - a relative specifier without an extension resolves to `<name>.ts` (then `.tsx`, then `.json`);
//   - `*.json` is loaded as an ES module with a default export.
// Usage:
//   node --experimental-loader ./tests/qa-loader.mjs --test tests/<file>.test.ts
// Add `--experimental-transform-types` when the module under test uses TypeScript-only runtime syntax
// (e.g. the parameter property in `src/services/multiDeviceSync.ts`), which Node's strip-only type
// removal rejects with ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX.
import { readFile } from 'node:fs/promises';

const CANDIDATE_EXTENSIONS = ['.ts', '.tsx', '.json', '.js'];

// Tauri's ESM entry points cannot be loaded by Node (they re-export types such as `UnlistenFn`, which
// Node's type-stripping leaves as a runtime import). The Client only calls them from inside functions,
// so an inert stub keeps the import graph loadable for tests that never touch the native bridge.
const STUBBED_PREFIXES = ['@tauri-apps/'];
const TAURI_STUB = [
  'data:text/javascript,',
  'export const invoke = async () => ({});',
  'export const listen = async () => () => {};',
  'export const UnlistenFn = undefined;',
  'export const emit = async () => {};',
  'export const WebviewWindow = class {};',
  'export default {};'
].join('');

export async function resolve(specifier, context, nextResolve) {
  if (STUBBED_PREFIXES.some((prefix) => specifier.startsWith(prefix))) {
    return { url: TAURI_STUB, shortCircuit: true };
  }
  if (specifier.startsWith('.') && !/\.[cm]?[jt]sx?$|\.json$/.test(specifier)) {
    for (const extension of CANDIDATE_EXTENSIONS) {
      try {
        return await nextResolve(specifier + extension, context);
      } catch {
        // try the next extension
      }
    }
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.endsWith('.json')) {
    const source = await readFile(new URL(url), 'utf8');
    return { format: 'module', shortCircuit: true, source: `export default ${source};` };
  }

  const result = await nextLoad(url, context);
  // `import.meta.env` is a Vite feature; several Client modules read `VITE_*` flags at module scope
  // (`src/config/environment.ts`), which throws under plain Node. Providing an empty object keeps the
  // module's documented fallbacks in play (`toBool(value, fallback)`), so tests exercise the defaults.
  if (/\.tsx?$/.test(url) && typeof result.source !== 'undefined') {
    const source = result.source.toString();
    if (source.includes('import.meta.env')) {
      return { ...result, source: `import.meta.env = import.meta.env || {};\n${source}` };
    }
  }
  return result;
}
