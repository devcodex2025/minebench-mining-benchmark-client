import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

console.log("Renderer: main.tsx initialized");

const bootstrap = async () => {
    // Tauri initialization must complete before React effects call native APIs.
    if ((window as any).__TAURI_INTERNALS__) {
        try {
            await import('./tauri-polyfill');
        } catch (err) {
            console.error('[Tauri-Polyfill] Failed to initialize:', err);
        }
    } else {
        console.warn("Renderer: Not running inside Tauri environment. Native features will be disabled.");
    }

    const rootElement = document.getElementById('root');
    if (!rootElement) {
        console.error("Renderer: Root element not found!");
    } else {
        createRoot(rootElement).render(
          <StrictMode>
            <App />
          </StrictMode>,
        )
    }
};

bootstrap();
