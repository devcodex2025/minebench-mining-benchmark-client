# Environment Configuration Implementation Summary

> **Note:** this document predates the Tauri v2 migration. The current desktop client is **Tauri v2** (`src-tauri/`); use `npm run tauri:dev` and `npm run tauri:build`. Electron references below are outdated.

## Overview
Successfully implemented a comprehensive environment configuration system for MineBench Client that allows rapid switching between development (localhost) and production (https://minebench.cloud) modes.

## What Was Implemented

### 1. **Core Configuration System**
- **File**: `src/config/environment.ts`
- Defines `EnvironmentConfig` interface with all service URLs
- Development configuration (localhost)
- Production configuration (minebench.cloud)
- Helper functions: `getEnvironment()`, `isDevelopment()`, `isProduction()`

### 2. **Environment-Specific Files**
- **`.env.development`**: Development URLs pointing to localhost
- **`.env.production`**: Production URLs pointing to minebench.cloud

### 3. **React Hooks**
- **File**: `src/hooks/useEnvironment.ts`
- `useEnvironment()` - Get full config object
- `useIsDevelopment()` - Check if in dev mode
- `useIsProduction()` - Check if in prod mode
- `useWalletAuthUrl()` - Get wallet auth URL
- `useApiBaseUrl()` - Get API base URL
- Additional hooks for each service URL

### 4. **Developer Settings Panel**
- **File**: `src/components/DeveloperSettings.tsx`
- Bottom-right corner toggle (gear icon)
- Shows current environment (dev/prod)
- Displays all active URLs
- Provides quick reference for npm scripts
- Only visible in development mode

### 5. **Updated npm Scripts**
- `npm run dev:local` - Development with localhost URLs
- `npm run dev:prod` - Development with production URLs
- `npm run build:dev` - Build for development
- `npm run build:prod` - Build for production
- Existing `dist` scripts now use production config

### 6. **Configuration Files Updated**
- **vite.config.ts**: Added environment mode support
- **package.json**: Added new npm scripts for dev/prod modes
- **SolanaAuthButton.tsx**: Updated to use environment config hooks
- **Layout.tsx**: Integrated DeveloperSettings component

### 7. **Documentation**
- **ENVIRONMENT_CONFIG.md**: Comprehensive configuration guide
- **README.md**: Updated with environment configuration section

## Configured URLs

### Development Mode (localhost)
```
Wallet Auth:    http://localhost:3000/auth
API Base:       http://localhost:3000/api
Backend:        http://localhost:3000
Wallet Service: http://localhost:3000/wallet
Sync Service:   ws://localhost:3000/sync
Solana RPC:     https://api.devnet.solana.com
Pool API:       http://localhost:8080/api
```

### Production Mode (minebench.cloud)
```
Wallet Auth:    https://minebench.cloud/auth
API Base:       https://minebench.cloud/api
Backend:        https://minebench.cloud
Wallet Service: https://minebench.cloud/wallet
Sync Service:   wss://minebench.cloud/sync
Solana RPC:     https://api.mainnet-beta.solana.com
Pool API:       https://minebench.cloud/api/pool
```

## How to Use

### Quick Mode Switching
```bash
# Local development with localhost
npm run dev:local

# Development with production URLs
npm run dev:prod

# Build for development
npm run build:dev

# Build for production
npm run build:prod
```

### In Components
```typescript
import { useWalletAuthUrl, useIsDevelopment } from '../hooks/useEnvironment';

export const MyComponent = () => {
  const walletUrl = useWalletAuthUrl();
  const isDev = useIsDevelopment();

  return (
    <div>
      <p>Auth URL: {walletUrl}</p>
      {isDev && <p>Running in development</p>}
    </div>
  );
};
```

### Visual Feedback
- In development mode, a gear icon appears in the bottom-right corner
- Click to open Developer Settings panel
- Shows all active URLs and current environment
- Provides build command reference

## Key Benefits

1. **Rapid Switching**: Change between environments with a single npm command
2. **No Hardcoding**: URLs are centrally managed and easily configurable
3. **Type-Safe**: Full TypeScript support with proper interfaces
4. **Developer-Friendly**: Visual settings panel shows all active URLs
5. **Solana Mainnet/Devnet**: Automatically switches RPC endpoints
6. **Production Ready**: Secure production URLs in final builds
7. **Extensible**: Easy to add new environment variables

## Files Created/Modified

### Created
- `src/config/environment.ts` - Core configuration
- `src/hooks/useEnvironment.ts` - React hooks
- `src/components/DeveloperSettings.tsx` - Settings panel
- `.env.development` - Development environment variables
- `.env.production` - Production environment variables
- `ENVIRONMENT_CONFIG.md` - Configuration guide

### Modified
- `vite.config.ts` - Added environment support
- `package.json` - Added new npm scripts
- `src/components/SolanaAuthButton.tsx` - Added useWalletAuthUrl hook
- `src/components/Layout.tsx` - Added DeveloperSettings component
- `README.md` - Added environment configuration section

## Next Steps

1. **Test Locally**: Run `npm run dev:local` and verify localhost URLs in Developer Settings
2. **Test Production URLs**: Run `npm run dev:prod` and verify minebench.cloud URLs
3. **Build Production**: Run `npm run build:prod` for final production build
4. **Electron Build**: Run `npm run dist` for complete application package

## Notes

- Environment is determined by `NODE_ENV` variable (or Vite's `mode`)
- `.env` files should NOT be committed to repository (already in .gitignore)
- Developer Settings panel is only shown in development mode
- Production builds will always use minebench.cloud URLs
- All existing npm scripts continue to work as expected
