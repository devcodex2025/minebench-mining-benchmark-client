# Environment Configuration Guide

> **Note:** this document predates the Tauri v2 migration. The current desktop client is **Tauri v2** (`src-tauri/`); use `npm run tauri:dev`. `electron/main.cjs` references below no longer exist.

## Overview

The MineBench Client now supports multiple environment configurations for seamless development and production switching. This allows developers to quickly change from local development URLs to production URLs (https://minebench.cloud) for wallet authorization and API endpoints.

## Environment Modes

### Development Mode
- **Wallet Auth**: `http://localhost:3000/auth`
- **API Base**: `http://localhost:3000/api`
- **Backend**: `http://localhost:3000`
- **Solana RPC**: `https://api.devnet.solana.com` (Devnet)
- **Sync Service**: `ws://localhost:3000/sync`

### Production Mode
- **Wallet Auth**: `https://minebench.cloud/auth`
- **API Base**: `https://minebench.cloud/api`
- **Backend**: `https://minebench.cloud`
- **Solana RPC**: `https://api.mainnet-beta.solana.com` (Mainnet)
- **Sync Service**: `wss://minebench.cloud/sync`

## Quick Start

### Running in Development Mode (Local URLs)
```bash
npm run dev:local
```

### Running with Production URLs in Dev Mode
```bash
npm run dev:prod
```

### Building for Development
```bash
npm run build:dev
```

### Building for Production
```bash
npm run build:prod
```

### Full Development with Tauri
```bash
npm run tauri:dev
```

### Building Distributables
```bash
# Windows
npm run dist:win

# macOS
npm run dist:mac

# Linux
npm run dist:linux

# All platforms
npm run dist:all
```

## How It Works

### Using Vite's Mode System

This configuration leverages Vite's built-in `--mode` flag:

- `--mode development` sets `import.meta.env.MODE = 'development'`
- `--mode production` sets `import.meta.env.MODE = 'production'` and `import.meta.env.PROD = true`

### Configuration Files

1. **`src/config/environment.ts`** - Main configuration file
   - Defines all environment variables
   - Provides helper functions to get current environment
   - Uses Vite's `import.meta.env.PROD` to determine environment

2. **`.env.development`** - Development environment variables
   - Used when running `npm run dev:local` or `npm run build:dev`
   - Points to localhost

3. **`.env.production`** - Production environment variables
   - Used when running `npm run dev:prod`, `npm run build:prod`, or building distributables
   - Points to https://minebench.cloud

### Usage in Components

Import the environment configuration hooks:

```typescript
import { 
  useEnvironment,
  useWalletAuthUrl,
  useApiBaseUrl,
  useIsDevelopment,
  useIsProduction 
} from '../hooks/useEnvironment';

// In your component
export const MyComponent = () => {
  const config = useEnvironment();
  const walletUrl = useWalletAuthUrl();
  const isDev = useIsDevelopment();

  return (
    <div>
      <p>Wallet Auth URL: {walletUrl}</p>
      {isDev && <p>Running in development mode</p>}
    </div>
  );
};
```

### Developer Settings Panel

In development mode, a Developer Settings panel appears in the bottom-right corner:

- Click the gear icon (⚙️) to open/close
- Shows current environment (dev/prod)
- Displays all active URLs
- Provides quick reference for build commands

## Switching Environments

### Method 1: Using npm scripts (Recommended)

```bash
# Switch to development (local URLs)
npm run dev:local

# Switch to production URLs in dev mode
npm run dev:prod

# Rebuild to switch permanently
npm run build:prod
```

### Method 2: Manual Configuration

Edit `src/config/environment.ts` to modify the configurations directly.

## Environment Variables Reference

| Variable | Description | Dev Value | Prod Value |
|----------|-------------|-----------|------------|
| `VITE_WALLET_AUTH_URL` | Wallet authorization endpoint | localhost | minebench.cloud |
| `VITE_API_BASE_URL` | API base URL | localhost | minebench.cloud |
| `VITE_BACKEND_URL` | Backend service URL | localhost | minebench.cloud |
| `VITE_WALLET_SERVICE_URL` | Wallet service endpoint | localhost | minebench.cloud |
| `VITE_SYNC_SERVICE_URL` | WebSocket sync service | ws://localhost | wss://minebench.cloud |
| `VITE_SOLANA_RPC_URL` | Solana RPC endpoint | devnet | mainnet-beta |
| `VITE_POOL_API_URL` | Pool API endpoint | localhost | minebench.cloud |

## Tauri Public Pool Config (Non-sensitive)

These are read by the Tauri client (`src-tauri/`) to fetch pool host/port config from the backend and reduce hardcoded values in the client build:

| Variable | Description | Dev Value | Prod Value |
|----------|-------------|-----------|------------|
| `PUBLIC_CONFIG_URL` | URL for backend public config endpoint | backend.minebench.cloud/public/config | backend.minebench.cloud/public/config |
| `POOL_CONFIG_ALLOWLIST` | Comma-separated host allowlist | xmr.minebench.cloud,xmr2.minebench.cloud,localhost,127.0.0.1 | xmr.minebench.cloud,xmr2.minebench.cloud |
| `PUBLIC_CONFIG_SIGNING_PUBLIC_KEY_PEM` | Optional public key to verify config signature | (optional) | (optional) |
| `POOL_CONFIG_ALLOW_ANY_HOST` | Dev escape hatch to accept any host | false | false |

## Tips for Development

1. **Local Testing**: Use `npm run dev:local` when developing with local backend services

2. **Testing Production URLs**: Use `npm run dev:prod` to test against production services without rebuilding

3. **Debugging**: The Developer Settings panel shows all active URLs for quick verification

4. **Building Distributables**: Always use production mode (`npm run build:prod` or `npm run dist:*`) for final builds

## Common Workflows

### Workflow 1: Develop Locally
```bash
# Terminal 1: Start your local backend
npm run dev:local  # Start frontend in dev mode

# Terminal 2: Start Tauri
npm run tauri:dev

# All requests go to localhost:3000
```

### Workflow 2: Test Production Integration
```bash
npm run dev:prod   # Start frontend with production URLs
npm run tauri:dev  # Start Tauri

# All requests go to minebench.cloud
# Useful for testing live API before building
```

### Workflow 3: Build for Release
```bash
npm run build:prod   # Build for production
npm run dist:all     # Create distributables for all platforms
```

## Troubleshooting

### URLs not changing when switching modes
- Check that you're using the new npm scripts (`dev:local`, `dev:prod`, `build:dev`, `build:prod`)
- Clear browser cache and rebuild if needed
- Verify `.env.development` and `.env.production` files exist

### Developer Settings panel not showing
- Only visible in development mode (`NODE_ENV=development`)
- Check that `useIsDevelopment()` returns true
- The panel appears in the bottom-right corner

### Wrong environment in production build
- Ensure you used `npm run build:prod` not `npm run build`
- Verify NODE_ENV is set correctly during build
- Check that `.env.production` has the correct URLs

## Adding New Environment Variables

1. Add the variable to both `.env.development` and `.env.production`:
   ```env
   VITE_NEW_SERVICE_URL=http://localhost:8000
   ```

2. Update `src/config/environment.ts`:
   ```typescript
   export interface EnvironmentConfig {
     // ... existing fields
     newServiceUrl: string;
   }

   const developmentConfig: EnvironmentConfig = {
     // ... existing config
     newServiceUrl: 'http://localhost:8000',
   };

   const productionConfig: EnvironmentConfig = {
     // ... existing config
     newServiceUrl: 'https://minebench.cloud/service',
   };
   ```

3. Create a hook in `src/hooks/useEnvironment.ts`:
   ```typescript
   export function useNewServiceUrl(): string {
     return config.newServiceUrl;
   }
   ```

4. Use in components:
   ```typescript
   import { useNewServiceUrl } from '../hooks/useEnvironment';
   
   const MyComponent = () => {
     const newServiceUrl = useNewServiceUrl();
     // Use newServiceUrl...
   };
   ```

## Related Files

- [src/config/environment.ts](../config/environment.ts) - Main configuration
- [src/hooks/useEnvironment.ts](../hooks/useEnvironment.ts) - React hooks
- [src/components/DeveloperSettings.tsx](../components/DeveloperSettings.tsx) - Settings panel
- [vite.config.ts](../../vite.config.ts) - Vite configuration
- [package.json](../../package.json) - npm scripts

## Support

For issues or questions about environment configuration, refer to the main README or check the Developer Settings panel in-app.
