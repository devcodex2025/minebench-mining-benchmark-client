# 🚀 Environment Configuration - Quick Reference

## What's New?

MineBench Client now supports **instant environment switching** between:
- **Development** (localhost for local testing)
- **Production** (https://minebench.cloud for live endpoints)

## One-Command Switching

### Development Mode
```bash
npm run dev:local
```
→ Wallet Auth: `http://localhost:3000/auth`  
→ API: `http://localhost:3000/api`  
→ Solana: `https://api.devnet.solana.com` (Devnet)

### Production Mode (in Dev)
```bash
npm run dev:prod
```
→ Wallet Auth: `https://minebench.cloud/auth`  
→ API: `https://minebench.cloud/api`  
→ Solana: `https://api.mainnet-beta.solana.com` (Mainnet)

## Building

```bash
# Build for development
npm run build:dev

# Build for production
npm run build:prod

# Create distributable packages
npm run dist:win     # Windows
npm run dist:mac     # macOS
npm run dist:linux   # Linux
npm run dist:all     # All platforms
```

## Visual Feedback

When running in **dev mode**, a settings gear ⚙️ appears in the **bottom-right corner**:
- Click to see current environment
- View all active URLs
- Get command reference

## Key Benefits

✅ No hardcoded URLs  
✅ Switch modes instantly  
✅ Visual confirmation in-app  
✅ Type-safe TypeScript  
✅ Easy to extend  

## Using in Code

```typescript
import { useWalletAuthUrl, useIsDevelopment } from '../hooks/useEnvironment';

export const MyComponent = () => {
  const walletUrl = useWalletAuthUrl();
  const isDev = useIsDevelopment();

  return (
    <p>Auth: {walletUrl}</p>
  );
};
```

## Files

- **Main Config**: `src/config/environment.ts`
- **Hooks**: `src/hooks/useEnvironment.ts`
- **Settings Panel**: `src/components/DeveloperSettings.tsx`
- **Full Guide**: `ENVIRONMENT_CONFIG.md`

## Common Workflows

### Local Testing with Backend
```bash
npm run dev:local
# → Uses localhost:3000
```

### Testing Against Production API
```bash
npm run dev:prod
# → Uses minebench.cloud (no rebuild needed!)
```

### Production Release
```bash
npm run build:prod && npm run dist:all
# → Creates final packages with minebench.cloud URLs
```

---

**Need help?** Check [ENVIRONMENT_CONFIG.md](ENVIRONMENT_CONFIG.md) for detailed documentation.
