import type { Metadata } from "next";

import { HistoryList } from "@/components/history/HistoryList";
import { Container, Section } from "@/components/layout/Container";
import { SiteFooter } from "@/components/navigation/SiteFooter";
import { SiteHeader } from "@/components/navigation/SiteHeader";
import { T } from "@/i18n";

export const metadata: Metadata = {
  title: "History",
  description: "Your saved breed identifications.",
};

export default function HistoryPage() {
  return (
    <>
      <SiteHeader />
      <main id="main">
        <Section spacing="tight">
          <Container>
            <h1 className="text-title font-semibold tracking-tight text-ink">
              <T k="nav.history" />
            </h1>
            <p className="mt-2 max-w-xl text-body text-ink-2 text-pretty">
              <T k="history.intro" />
            </p>
            <div className="mt-8">
              <HistoryList />
            </div>
          </Container>
        </Section>
      </main>
      <SiteFooter />
    </>
  );
}
