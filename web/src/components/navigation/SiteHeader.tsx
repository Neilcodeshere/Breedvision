"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { Container } from "@/components/layout/Container";
import { ButtonLink } from "@/components/ui/Button";
import { Logo } from "@/components/ui/Logo";
import { LanguageSwitcher } from "@/components/navigation/LanguageSwitcher";
import { useT, type MessageKey } from "@/i18n";
import { cn } from "@/lib/cn";
import { ACCOUNTS_ENABLED } from "@/services/config";

interface NavItem {
  href: string;
  label: MessageKey;
}

// Only routes that exist. "How it works" lives as a section on the home page
// rather than a separate route, and there is no auth yet — linking to pages
// that 404 is worse than not offering them.
const PUBLIC_NAV: NavItem[] = [
  { href: "/breeds", label: "nav.breeds" },
  { href: "/history", label: "nav.history" },
  { href: "/prices", label: "nav.prices" },
  ...(ACCOUNTS_ENABLED
    ? [{ href: "/account", label: "nav.account" } as NavItem]
    : []),
];

export function SiteHeader() {
  const pathname = usePathname();
  const t = useT();
  const [open, setOpen] = useState(false);

  // Close the mobile menu on navigation, otherwise it hangs open over the new
  // page. Adjusted during render rather than in an effect — React re-runs this
  // component immediately without painting the stale open menu first.
  const [lastPathname, setLastPathname] = useState(pathname);
  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    setOpen(false);
  }

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-paper/85 backdrop-blur-sm">
      <Container>
        <div className="flex h-16 items-center justify-between gap-6">
          <Link
            href="/"
            className="text-forest-deep"
            aria-label={t("nav.home")}
          >
            <Logo />
          </Link>

          <nav
            aria-label={t("nav.primary")}
            className="hidden items-center gap-1 md:flex"
          >
            {PUBLIC_NAV.map((item) => {
              const active =
                pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "rounded-md px-3 py-2 text-small font-medium transition-colors",
                    active
                      ? "text-ink"
                      : "text-ink-3 hover:bg-paper-sunk hover:text-ink",
                  )}
                >
                  {t(item.label)}
                </Link>
              );
            })}
          </nav>

          <div className="hidden items-center gap-2 md:flex">
            <LanguageSwitcher />
            <ButtonLink href="/identify" size="sm">
              {t("nav.identify")}
            </ButtonLink>
          </div>

          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="mobile-nav"
            className="-mr-2 inline-flex h-11 w-11 items-center justify-center rounded-md text-ink-2 md:hidden"
          >
            <span className="sr-only">
              {open ? t("nav.closeMenu") : t("nav.openMenu")}
            </span>
            <svg
              viewBox="0 0 20 20"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              aria-hidden="true"
            >
              {open ? (
                <path d="M5 5l10 10M15 5L5 15" />
              ) : (
                <path d="M3 6h14M3 10h14M3 14h14" />
              )}
            </svg>
          </button>
        </div>
      </Container>

      {open ? (
        <div id="mobile-nav" className="border-t border-line bg-paper md:hidden">
          <Container>
            <nav aria-label={t("nav.primary")} className="flex flex-col py-3">
              {PUBLIC_NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-md px-2 py-3 text-body font-medium text-ink-2 hover:bg-paper-sunk hover:text-ink"
                >
                  {t(item.label)}
                </Link>
              ))}
              <LanguageSwitcher className="mt-2" />
              <ButtonLink href="/identify" size="lg" block className="mt-3 mb-2">
                {t("nav.identify")}
              </ButtonLink>
            </nav>
          </Container>
        </div>
      ) : null}
    </header>
  );
}
