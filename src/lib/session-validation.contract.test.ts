import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Contract coverage for Phantom/multi-wallet session handling in the desktop client.
// Locks in the hardened flow: server nonce, sliding JWT refresh, server-side
// session validation, no persisted login signature, and wallet-switch handling.
const authServiceSource = readFileSync(
  new URL('../services/solanaAuth.ts', import.meta.url),
  'utf8'
);
const authButtonSource = readFileSync(
  new URL('../components/SolanaAuthButton.tsx', import.meta.url),
  'utf8'
);

// Login must exchange a wallet signature over a server-issued nonce for a backend JWT.
assert.match(
  authServiceSource,
  /\/api\/auth\/nonce/,
  'Wallet login must fetch a server-issued nonce'
);
assert.match(
  authServiceSource,
  /login\(walletAddress[\s\S]*?backendJson[\s\S]*?['"]\/api\/auth\/login['"]/,
  'Wallet login must call the backend /api/auth/login endpoint'
);
assert.doesNotMatch(
  authServiceSource,
  /authStorage\.setSignature\(/,
  'The raw login signature must not be persisted'
);

// Session must refresh silently and be validated on the server.
assert.match(
  authServiceSource,
  /['"]\/api\/auth\/refresh['"]/,
  'Client must support silent JWT refresh'
);
assert.match(
  authServiceSource,
  /['"]\/api\/auth\/session['"]/,
  'Client must validate the session against the backend'
);
assert.match(
  authServiceSource,
  /scheduleTokenRefresh\(\)/,
  'Client must schedule token refresh before expiry'
);
assert.match(
  authServiceSource,
  /__TAURI_INTERNALS__[\s\S]{0,400}validateSession\(\)/,
  'Desktop verifyConnection must validate the session server-side'
);

// A 401 must clear the token and raise the session-expired flag.
assert.match(
  authServiceSource,
  /status === 401[\s\S]*?removeToken\(\)[\s\S]*?setSessionExpired\(true\)/,
  'A 401 must clear the token and raise the session-expired flag'
);

// Disconnect must clear both the JWT and any stored signature.
assert.match(
  authServiceSource,
  /disconnectWallet[\s\S]*?localStorage\.removeItem\('minebench_user'\)[\s\S]*?clearSecrets\(\)/,
  'Disconnect must clear the stored user and auth secrets'
);

// Multi-wallet: the web flow must probe more than Phantom.
assert.match(
  authServiceSource,
  /getInjectedWallet[\s\S]*?w\.solflare[\s\S]*?w\.backpack[\s\S]*?w\.glow/,
  'Web flow must support multiple injected Solana wallets'
);

// Wallet switch/disconnect must invalidate the session so rewards are not misattributed.
assert.match(
  authButtonSource,
  /accountChanged[\s\S]*?invalidateSession|invalidateSession[\s\S]*?accountChanged/,
  'Switching account or disconnecting must invalidate the session'
);

// Startup must restore the user, verify the connection and refresh stats.
assert.match(
  authButtonSource,
  /loadUserFromStorage\(\)[\s\S]*?verifyConnection\(\)[\s\S]*?fetchMiningStats\(/,
  'Startup must restore the user, verify the connection and refresh stats'
);

console.log('Solana wallet session handling contract tests passed');
