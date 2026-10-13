# AI Assistant Instructions for MineBench

## Project Overview
MineBench is an Electron-based desktop application for GPU mining benchmarking of Ravencoin (RVN), built with React, TypeScript, and Vite. The app provides real-time monitoring of mining statistics through a user interface.

## Key Architecture Components

### Frontend (React + TypeScript)
- Entry point: `src/main.tsx` bootstraps the React application
- Main UI: `src/App.tsx` contains the mining dashboard with real-time charts
- Uses Recharts for visualization of hashrate and temperature data
- Styling: Combination of CSS modules (`src/App.css`, `src/index.css`)

### Backend (Electron)
- Main process: `electron/main.cjs` handles miner process management
- Preload script: `electron/preload.js` exposes safe IPC communication
- IPC channels:
  - `start-miner`: Launches GMiner with configured parameters
  - `stop-miner`: Terminates the mining process

### Mining Integration
- GMiner executable location: `/miner/Gminer/miner.exe`
- Default mining pool: rvn.2miners.com:6060
- API endpoint: Local GMiner interface at http://127.0.0.1:4067/summary
- Pool stats: https://rvn.2miners.com/api/accounts/{wallet}

## Development Workflow

### Getting Started
```bash
npm install          # Install dependencies
npm run dev:all     # Start development environment (Vite + Electron)
npm run dist        # Build and package for distribution
```

### Key Files for Common Tasks
- Adding UI components: Create in `src/` directory
- Electron IPC handlers: Add to `electron/main.cjs`
- Miner configuration: Update params in `start-miner` handler

## Project Conventions

### TypeScript Configuration
- Frontend config: `tsconfig.app.json` (React)
- Node.js config: `tsconfig.node.json` (Electron)
- Strict type checking enabled

### State Management
- Uses React hooks for local state
- Mining stats polling:
  - Miner stats: Every 5 seconds
  - Pool stats: Every 15 seconds

### Error Handling
- Mining process errors logged to console and UI
- API failures handled gracefully with user feedback

## Integration Points

### External APIs
- GMiner API: Local JSON API for hardware stats
- 2miners Pool API: Remote API for pool statistics

### IPC Communication
- All Electron interactions go through `window.electron.invoke()`
- Defined in `src/global.d.ts` for TypeScript support