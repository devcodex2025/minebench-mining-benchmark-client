import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import { CrossChannelPrompt } from './components/CrossChannelPrompt'

console.log("Renderer: main.tsx initialized");

const rootElement = document.getElementById('root');
if (!rootElement) {
    console.error("Renderer: Root element not found!");
} else {
    createRoot(rootElement).render(
      <StrictMode>
        <ErrorBoundary>
          <App />
          <CrossChannelPrompt />
        </ErrorBoundary>
      </StrictMode>,
    )
}
