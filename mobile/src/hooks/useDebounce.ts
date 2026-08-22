import { useEffect, useState } from 'react';

/**
 * Return a value that lags `value` by `delayMs`. Perfect for search inputs —
 * bind the raw text to state, useDebounce it, and query on the debounced
 * value so we don't spam the server on every keystroke.
 */
export function useDebounce<T>(value: T, delayMs = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}
