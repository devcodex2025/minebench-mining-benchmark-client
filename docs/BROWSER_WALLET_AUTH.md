# Solana Wallet Authentication (Tauri Desktop + Web)

## Overview

MineBench authenticates a Solana wallet with a system-browser flow. The desktop
client is **Tauri v2** (Rust core + WebView), not Electron.

- Works with any **Wallet Standard** wallet: Phantom, Solflare, Backpack, Glow,
  Magic Eden, and others (no per-wallet code).
- Ownership is proven with a Solana `signMessage` signature.
- Login is protected by a **server-issued single-use nonce** (anti-replay).
- The session is a JWT that is validated and refreshed server-side.

## Architecture

```
┌─────────────────┐        ┌──────────────────┐        ┌─────────────────────┐
│  Tauri Client   │        │  System Browser  │        │  MineBench UI       │
│  (Rust + WebView)│──────▶│  minebench.cloud │──────▶│  /wallet-connect    │
│  solana_connect_ │        │  /wallet-connect │        │  WalletMultiButton  │
│  wallet command  │        │                  │        │  (Wallet Standard)  │
└─────────────────┘        └──────────────────┘        └─────────────────────┘
        ▲                                                         │
        │  1. GET /api/auth/nonce?walletAddress=…                 │
        │  2. sign server message (nonce)                         │
        │  3. GET localhost:PORT/callback?state=…&publicKey=…     │
        │     &signature=…&message=…                              │
        └─────────────────────────────────────────────────────────┘
              │
              ▼
   POST /api/auth/login { walletAddress, signature, message }
     → verify signature + consume nonce → JWT (24h)
```

## Desktop flow (Tauri)

1. `SolanaAuthService.connectWallet()` detects Tauri via `__TAURI_INTERNALS__`
   and invokes the `solana_connect_wallet` Rust command
   (`MineBench-Client/src-tauri/src/commands.rs`).
2. The command starts a loopback Axum server on a random port and opens
   `https://minebench.cloud/wallet-connect?callbackUrl=http://localhost:PORT/callback?state=<csrf>`
   in the system browser. A 300 s timeout applies.
3. On the page the user selects a wallet via `WalletMultiButton`. The page calls
   `GET /api/auth/nonce?walletAddress=<pubkey>`, receives the exact message to sign
   (containing a single-use nonce), signs it, then GET-redirects to the loopback
   callback with `publicKey`, base64 `signature` and `message`.
4. Rust validates the `state` value, resolves the pending promise, and the client
   normalizes the signature (base64 → base58).
5. The client posts `{ walletAddress, signature, message }` to
   `POST /api/auth/login`. The backend verifies the Ed25519 signature, consumes the
   nonce atomically, and returns a JWT.

## Web flow

`SolanaAuthService.connectWallet()` probes injected providers
(`window.phantom?.solana`, `window.solflare`, `window.backpack`, `window.glow`,
`window.magicEden?.solana`, `window.solana`), requests the nonce, signs the server
message, and logs in.

## Login message (signed by the wallet)

```
MineBench Wallet Authentication
Domain: minebench.cloud
Wallet: <base58 public key>
Nonce: <32 hex chars, server issued>
Issued At: <ISO-8601>
Expires At: <ISO-8601>
```

The server stores the nonce, its expiry (default 300 s) and the exact message.
Login succeeds only when the signature is valid **and** the referenced nonce
exists, is unused, is unexpired, and belongs to the same wallet. Consumption is a
conditional `UPDATE ... WHERE used_at IS NULL AND expires_at > now()`.

## Session lifecycle

| Concern | Behaviour |
|---|---|
| Session token | JWT, 24 h (`JWT_SECRET`, `config.jwt.expiresIn`) |
| Validation | `GET /api/auth/session` (authGuard) on startup |
| Refresh | `POST /api/auth/refresh` (authGuard), sliding 24 h |
| Keep-alive | Client refreshes 5 min before expiry (`scheduleTokenRefresh`) |
| 401 handling | `fetchMiningStats`/`reportMiningStats` refresh once, then retry |
| Storage | JWT in web storage; the **login signature is never persisted** |
| Wallet switch | `accountChanged`/`disconnect` invalidate the local session |

## Backend

- `MineBench-Backend/src/modules/iam/iam.service.ts` — signature + nonce verification.
- `MineBench-Backend/src/modules/iam/iam.routes.ts` — `/auth/nonce`, `/auth/login`,
  `/auth/refresh`, `/auth/session`.
- `MineBench-Backend/src/database/migrations/027_auth_nonce.sql` — `auth_nonces` table.
- `AUTH_REQUIRE_NONCE` (default `true`) gates nonce enforcement during rollout.
  Keep it `true` in production.

## Deployment order for the nonce rollout

1. Apply migration `027_auth_nonce.sql` (backup + isolated restore gate first).
2. Deploy the backend (`AUTH_REQUIRE_NONCE=true`).
3. Deploy MineBench-UI (wallet-connect page requests a nonce).
4. Release the desktop client.

Rolling back step 2 while step 1 is applied is safe. Dropping `auth_nonces` and
staying on the nonce-enforcing backend will break login, so only roll back to the
previous backend build together with the schema change.

## Environment overrides (desktop)

The Tauri client resolves hosts from env at runtime, then compile-time
`option_env!`, then the production default:

- `MINEBENCH_BACKEND_URL` (default `https://backend.minebench.cloud`)
- `MINEBENCH_UI_URL` (default `https://minebench.cloud`)
- `MINEBENCH_SOLANA_RPC_URL` (default `https://api.mainnet-beta.solana.com`)

This allows pointing a dev/test build at staging without a production rebuild.

## Troubleshooting

- **No wallet listed** — the page needs a Wallet Standard wallet extension in the
  browser profile that opens; `wallet-connect` runs outside the desktop WebView.
- **"Invalid or expired login nonce"** — the nonce was already used, expired
  (default 300 s), or the message was altered. Start the connection again.
- **localhost connection refused** — a firewall is blocking the loopback callback
  port; allow the client executable.
