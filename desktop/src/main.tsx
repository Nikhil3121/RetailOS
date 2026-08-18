/**
 * Renderer entry.
 * Mounts the React tree inside <div id="root"> and installs the QueryClient +
 * BrowserRouter providers so every component below can consume server state
 * and navigation via hooks alone.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';

import { queryClient } from '@/lib/query-client';
import { router } from '@/router';

import '@/styles/index.css';

const container = document.getElementById('root');
if (!container) throw new Error('#root element not found in index.html');

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
