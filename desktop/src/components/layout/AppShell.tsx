import { Outlet } from 'react-router-dom';

import { AppShortcuts } from '@/components/AppShortcuts';
import { Sidebar } from './Sidebar';
import { TitleBar } from './TitleBar';

/**
 * The persistent application chrome: draggable title bar on top, sidebar on
 * the left, routed content on the right. Every authenticated route renders
 * inside this shell so navigation feels continuous.
 */
export function AppShell(): JSX.Element {
  return (
    <div className="relative flex h-screen w-screen flex-col bg-ink-950 text-slate-200">
      <AppShortcuts />
      <div className="pointer-events-none absolute inset-0 grid-overlay opacity-60" />
      <TitleBar />
      <div className="relative flex min-h-0 flex-1">
        <Sidebar />
          <main className="relative z-0 flex-1 overflow-auto">
          <div className="mx-auto max-w-[1600px] px-8 py-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
