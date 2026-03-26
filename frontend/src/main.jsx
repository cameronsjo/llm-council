import * as Sentry from '@sentry/browser';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
});

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN || '',
  environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || 'development',
  enabled: !!import.meta.env.VITE_SENTRY_DSN,

  integrations: [
    Sentry.browserTracingIntegration({
      enableLongTask: true,
      enableInp: true,
    }),
  ],

  // Performance monitoring
  tracesSampleRate: parseFloat(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE || '0.1'),

  // Distributed tracing — propagate sentry-trace/baggage headers to our API
  // Same-origin requests are traced automatically; this covers dev proxy too
  tracePropagationTargets: [
    'localhost',
    /^\/api\//,
    /^https:\/\/council\.sjo\.lol/,
  ],
});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
