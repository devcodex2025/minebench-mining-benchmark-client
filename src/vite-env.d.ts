/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_TITLE: string;
  /** Delivery channel, set by the `build:<channel>` scripts. */
  readonly VITE_APP_CHANNEL?: string;
  /** Solana RPC endpoint; nightly builds must point at a test cluster. */
  readonly VITE_SOLANA_RPC_URL?: string;
  readonly MODE: string;
  readonly PROD: boolean;
  readonly DEV: boolean;
  readonly SSR: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
