"use client";

import { useEffect, useRef, useState } from "react";
import { Sun, Moon, Laptop, X } from "lucide-react";
import { useTheme, Theme } from "@/lib/theme";
import { useCurrency, Currency } from "@/lib/currency";

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative w-9 h-5 rounded-full shrink-0 transition-colors ${
        checked ? "bg-primary" : "bg-line"
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-surface transition-transform ${
          checked ? "translate-x-4" : "translate-x-0"
        }`}
      />
    </button>
  );
}

export default function SettingsPanel({ onClose }: { onClose: () => void }) {
  const [theme, setTheme] = useTheme();
  const [currency, setCurrency] = useCurrency();
  const [emailNotifs, setEmailNotifs] = useState(true);
  const [productUpdates, setProductUpdates] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [onClose]);

  const themeOptions: { key: Theme; label: string; icon: typeof Sun }[] = [
    { key: "light", label: "Light", icon: Sun },
    { key: "dark", label: "Dark", icon: Moon },
    { key: "system", label: "System", icon: Laptop },
  ];
  const currencyOptions: { key: Currency; label: string }[] = [
    { key: "EUR", label: "€ EUR" },
    { key: "GBP", label: "£ GBP" },
    { key: "USD", label: "$ USD" },
  ];

  return (
    <div
      ref={ref}
      className="absolute bottom-[calc(100%+10px)] left-0 w-[280px] bg-surface border border-line rounded-md shadow-xl z-30 flex flex-col gap-4 p-4"
    >
      <div className="flex items-center justify-between">
        <span className="font-semibold text-[14px]">Settings</span>
        <button onClick={onClose} aria-label="Close settings" className="text-muted hover:text-ink">
          <X size={15} strokeWidth={1.8} />
        </button>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-[11px] font-semibold text-faint tracking-[0.07em]">APPEARANCE</span>
        <div className="flex gap-1.5">
          {themeOptions.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTheme(key)}
              className={`flex-1 flex flex-col items-center gap-1 py-2 rounded-md text-[11px] ${
                theme === key
                  ? "border border-primary text-primary bg-primary-tint"
                  : "border border-line text-sub hover:border-primary hover:text-primary"
              }`}
            >
              <Icon size={14} strokeWidth={1.8} />
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-[11px] font-semibold text-faint tracking-[0.07em]">DEFAULT CURRENCY</span>
        <div className="flex gap-1.5">
          {currencyOptions.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setCurrency(key)}
              className={`flex-1 py-2 rounded-md text-[12px] font-semibold ${
                currency === key
                  ? "border border-primary text-primary bg-primary-tint"
                  : "border border-line text-sub hover:border-primary hover:text-primary"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2.5">
        <span className="text-[11px] font-semibold text-faint tracking-[0.07em]">NOTIFICATIONS</span>
        <div className="flex items-center justify-between">
          <span className="text-[13px] text-sub">Email notifications</span>
          <Toggle checked={emailNotifs} onChange={setEmailNotifs} />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[13px] text-sub">Product updates</span>
          <Toggle checked={productUpdates} onChange={setProductUpdates} />
        </div>
      </div>

      <div className="text-[11px] text-faint border-t border-line pt-3">
        Appearance and currency apply across Helmonic and are remembered on this device.
      </div>
    </div>
  );
}
