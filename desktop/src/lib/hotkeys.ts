import { useEffect } from 'react';

/**
 * Lightweight keyboard-shortcut hook.
 *
 * A single call registers one shortcut; call the hook multiple times to bind
 * multiple keys. Function keys (F1-F12) work without modifiers even inside
 * <input> / <textarea> — that's the POS convention operators expect.
 *
 * Handlers get preventDefault() by default because F-keys otherwise trigger
 * browser/OS defaults (F3 = find, F7 = caret browsing, F10 = menu focus).
 */

type HotkeyHandler = (event: KeyboardEvent) => void;

interface HotkeyOptions {
  /** Set false to allow the browser's default action to fire alongside our handler. */
  preventDefault?: boolean;
  /**
   * When true (default) the shortcut still fires while an input is focused —
   * important for POS flow where the operator's cursor lives in the search
   * box. Set false for shortcuts that should not steal keystrokes from typing
   * (e.g. plain letter keys).
   */
  fireInInputs?: boolean;
  /** If false, the handler is disabled without needing to remount. */
  enabled?: boolean;
}

/**
 * Case-insensitive check that the event matches the requested key string.
 * Accepts function keys ("F2"), letters ("k"), and named keys ("Escape").
 */
function matches(event: KeyboardEvent, key: string): boolean {
  return event.key.toLowerCase() === key.toLowerCase();
}

export function useHotkey(
  key: string,
  handler: HotkeyHandler,
  {
    preventDefault = true,
    fireInInputs = true,
    enabled = true,
  }: HotkeyOptions = {},
): void {
  useEffect(() => {
    if (!enabled) return;

    function onKeyDown(event: KeyboardEvent): void {
      if (!matches(event, key)) return;

      if (!fireInInputs) {
        const target = event.target as HTMLElement | null;
        const tag = target?.tagName;
        const editable = target?.isContentEditable;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || editable) {
          return;
        }
      }

      if (preventDefault) event.preventDefault();
      handler(event);
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [key, handler, enabled, preventDefault, fireInInputs]);
}
