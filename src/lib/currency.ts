"use client";

import { useCallback, useSyncExternalStore } from "react";

export type Currency = "EUR" | "GBP" | "USD";
const KEY = "helmonic.currency";
const listeners = new Set<() => void>();

// Indicative rates against EUR, for demonstration only.
const RATES: Record<Currency, number> = { EUR: 1, GBP: 0.86, USD: 1.09 };
const SYMBOLS: Record<Currency, string> = { EUR: "€", GBP: "£", USD: "$" };
// Matches the non-breaking and narrow no-break spaces that Intl's fr-FR grouping uses,
// so they can be normalized to a plain space (U+0020) for consistent rendering everywhere.
const LOCALE_SPACE_CHARS = new RegExp("[\\u00A0\\u2009\\u202F]", "g");

/** Formats a EUR-denominated amount into the target currency's display convention. */
export function formatCurrency(amountEur: number, currency: Currency): string {
  const value = amountEur * RATES[currency];
  const symbol = SYMBOLS[currency];
  if (currency === "EUR") {
    // fr-FR gives space-thousands, comma-decimal, matching the rest of the app's EUR figures.
    const raw = value.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${symbol}${raw.replace(LOCALE_SPACE_CHARS, " ")}`;
  }
  const formatted = value.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${symbol}${formatted}`;
}

function getSnapshot(): Currency {
  return (window.localStorage.getItem(KEY) as Currency | null) ?? "EUR";
}

function getServerSnapshot(): Currency {
  return "EUR";
}

function subscribe(onStoreChange: () => void) {
  listeners.add(onStoreChange);
  return () => listeners.delete(onStoreChange);
}

export function useCurrency(): [Currency, (c: Currency) => void] {
  const currency = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setCurrency = useCallback((c: Currency) => {
    window.localStorage.setItem(KEY, c);
    listeners.forEach((l) => l());
  }, []);

  return [currency, setCurrency];
}
