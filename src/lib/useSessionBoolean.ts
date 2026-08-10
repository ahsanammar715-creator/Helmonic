"use client";

import { useCallback, useSyncExternalStore } from "react";

const listeners = new Map<string, Set<() => void>>();

function notify(key: string) {
  listeners.get(key)?.forEach((l) => l());
}

function subscribe(key: string) {
  return (onStoreChange: () => void) => {
    if (!listeners.has(key)) listeners.set(key, new Set());
    listeners.get(key)!.add(onStoreChange);
    return () => listeners.get(key)?.delete(onStoreChange);
  };
}

/**
 * Boolean preference persisted to sessionStorage, shared across every
 * component reading the same key within a tab. Falls back to `fallback`
 * during SSR and before hydration so server/client markup match.
 */
export function useSessionBoolean(key: string, fallback: boolean): [boolean, (v: boolean) => void] {
  const getSnapshot = useCallback(() => {
    const raw = window.sessionStorage.getItem(key);
    if (raw === "open") return true;
    if (raw === "closed") return false;
    return fallback;
  }, [key, fallback]);

  const getServerSnapshot = useCallback(() => fallback, [fallback]);

  const value = useSyncExternalStore(subscribe(key), getSnapshot, getServerSnapshot);

  const setValue = useCallback(
    (next: boolean) => {
      window.sessionStorage.setItem(key, next ? "open" : "closed");
      notify(key);
    },
    [key]
  );

  return [value, setValue];
}
