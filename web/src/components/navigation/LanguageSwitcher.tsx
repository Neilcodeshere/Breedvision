"use client";

import { LOCALES, setLocale, useLocale, useT, type LocaleCode } from "@/i18n";
import { cn } from "@/lib/cn";

/**
 * Native-script names, so a person who cannot read English can still find
 * their language. A plain <select> keeps it keyboard- and screen-reader-native.
 */
export function LanguageSwitcher({ className }: { className?: string }) {
  const locale = useLocale();
  const t = useT();
  return (
    <label className={cn("inline-flex items-center", className)}>
      <span className="sr-only">{t("lang.label")}</span>
      <select
        value={locale}
        onChange={(e) => setLocale(e.target.value as LocaleCode)}
        className="h-10 rounded-md border border-field-line bg-surface px-2.5 text-small font-medium text-ink-2 hover:text-ink"
      >
        {LOCALES.map((l) => (
          <option key={l.code} value={l.code}>
            {l.label}
          </option>
        ))}
      </select>
    </label>
  );
}
