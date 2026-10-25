"use client";

import { useCallback, useEffect, useSyncExternalStore, type ReactNode } from "react";

import { en, type MessageKey } from "./messages/en";
import { hi } from "./messages/hi";
import { mr } from "./messages/mr";
import { ta } from "./messages/ta";
import { te } from "./messages/te";

export type { MessageKey };

export const LOCALES = [
  { code: "en", label: "English", tag: "en-IN" },
  { code: "hi", label: "हिन्दी", tag: "hi-IN" },
  { code: "mr", label: "मराठी", tag: "mr-IN" },
  { code: "ta", label: "தமிழ்", tag: "ta-IN" },
  { code: "te", label: "తెలుగు", tag: "te-IN" },
] as const;

export type LocaleCode = (typeof LOCALES)[number]["code"];

const CATALOGUES: Record<LocaleCode, Partial<Record<MessageKey, string>>> = {
  en,
  hi,
  mr,
  ta,
  te,
};

const STORAGE_KEY = "breedvision.locale";

function isLocale(v: unknown): v is LocaleCode {
  return LOCALES.some((l) => l.code === v);
}

/* A tiny external store: the language is browser state (localStorage), not
   React state, so useSyncExternalStore lets the server render English and the
   browser switch to the saved language without a hydration mismatch. */
const listeners = new Set<() => void>();

function readStored(): LocaleCode {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isLocale(saved)) return saved;
    // First visit: follow the browser language if we have it, else English.
    const nav = navigator.language?.slice(0, 2);
    if (isLocale(nav)) return nav;
  } catch {
    /* storage can be blocked; English is the safe default */
  }
  return "en";
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

export function setLocale(code: LocaleCode) {
  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch {
    /* the choice just won't persist */
  }
  listeners.forEach((l) => l());
}

export function useLocale(): LocaleCode {
  return useSyncExternalStore(subscribe, readStored, () => "en" as LocaleCode);
}

export type Translate = (
  key: MessageKey,
  vars?: Record<string, string | number>,
) => string;

export function translate(
  locale: LocaleCode,
  key: MessageKey,
  vars?: Record<string, string | number>,
): string {
  let text = CATALOGUES[locale][key] ?? en[key];
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replaceAll(`{${k}}`, String(v));
    }
  }
  return text;
}

/** `t("key", { name })` for the current language. */
export function useT(): Translate {
  const locale = useLocale();
  return useCallback((key, vars) => translate(locale, key, vars), [locale]);
}

/** BCP-47 tag for date formatting in the current language. */
export function useDateTag(): string {
  const locale = useLocale();
  return LOCALES.find((l) => l.code === locale)?.tag ?? "en-IN";
}

/** Keeps <html lang> in step with the chosen language (screen readers, fonts). */
export function LocaleSync({ children }: { children?: ReactNode }) {
  const locale = useLocale();
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  return <>{children}</>;
}

/** Inline translated text, for server components that cannot call hooks. */
export function T({
  k,
  vars,
}: {
  k: MessageKey;
  vars?: Record<string, string | number>;
}) {
  const t = useT();
  return <>{t(k, vars)}</>;
}
