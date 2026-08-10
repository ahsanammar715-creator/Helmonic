"use client";

import { useCallback, useSyncExternalStore } from "react";

export type Theme = "light" | "dark" | "system";
const KEY = "helmonic.theme";
const listeners = new Set<() => void>();

export const THEME_INIT_SCRIPT = `
(function () {
  try {
    var t = localStorage.getItem('${KEY}') || 'system';
    var dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', dark);
  } catch (e) {}
})();
`;

function apply(theme: Theme) {
  const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

function getSnapshot(): Theme {
  return (window.localStorage.getItem(KEY) as Theme | null) ?? "system";
}

function getServerSnapshot(): Theme {
  return "system";
}

function subscribe(onStoreChange: () => void) {
  listeners.add(onStoreChange);
  return () => listeners.delete(onStoreChange);
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setTheme = useCallback((t: Theme) => {
    window.localStorage.setItem(KEY, t);
    apply(t);
    listeners.forEach((l) => l());
  }, []);

  return [theme, setTheme];
}
