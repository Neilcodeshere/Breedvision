"use client";

import Link from "next/link";

import { Container } from "@/components/layout/Container";
import { Logo } from "@/components/ui/Logo";
import { useT, type MessageKey } from "@/i18n";

// Only routes that exist. The previous "Project" group linked entirely to pages
// that had never been built (/about, /how-it-works) and returned 404.
const LINKS: { href: string; label: MessageKey }[] = [
  { href: "/identify", label: "nav.identify" },
  { href: "/breeds", label: "footer.breedLibrary" },
  { href: "/history", label: "nav.history" },
  { href: "/model", label: "model.title" },
];

export function SiteFooter() {
  const t = useT();
  return (
    <footer className="border-t border-line bg-paper-sunk">
      <Container>
        <div className="grid gap-10 py-14 sm:grid-cols-2">
          <div>
            <span className="text-forest-deep">
              <Logo />
            </span>
            <p className="mt-4 max-w-xs text-small text-ink-3 text-pretty">
              {t("footer.tagline")}
            </p>
          </div>

          <nav aria-label={t("footer.product")} className="sm:justify-self-end">
            <h2 className="text-micro font-semibold uppercase tracking-[0.14em] text-ink-3">
              {t("footer.product")}
            </h2>
            <ul className="mt-4 flex flex-col gap-2.5">
              {LINKS.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-small text-ink-2 transition-colors hover:text-forest"
                  >
                    {t(link.label)}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        <div className="flex flex-col gap-2 border-t border-line py-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-micro text-ink-3">
            {t("footer.disclaimer")}
          </p>
          {/* ink-4 clears AA on paper and surface but only reaches 4.31:1 on
              the darker paper-sunk, so this label uses ink-3. */}
          <p className="text-micro text-ink-3">{t("footer.prototype")}</p>
        </div>
      </Container>
    </footer>
  );
}
