import type { Metadata } from "next";
import { Suspense } from "react";

import { Container, Section } from "@/components/layout/Container";
import { SiteFooter } from "@/components/navigation/SiteFooter";
import { SiteHeader } from "@/components/navigation/SiteHeader";
import { SalesWorkspace } from "@/components/prices/SalesWorkspace";
import { ValueCalculator } from "@/components/prices/ValueCalculator";
import { LoadingState } from "@/components/states";
import { T } from "@/i18n";

export const metadata: Metadata = {
  title: "Find the value of your cattle",
  description:
    "An indicative rupee estimate for a cow, from listed breed price ranges, milk yield and pregnancy, plus a log of real sale prices.",
};

export default function PricesPage() {
  return (
    <>
      <SiteHeader />
      <main id="main">
        <Section spacing="tight">
          <Container width="wide">
            <h1 className="text-title font-semibold tracking-tight text-ink">
              <T k="value.title" />
            </h1>
            <p className="mt-2 max-w-xl text-body text-ink-2 text-pretty">
              <T k="value.intro" />
            </p>
            <div className="mt-8 flex flex-col gap-10">
              {/* useSearchParams (the ?breed= link from a result) needs Suspense. */}
              <Suspense fallback={<LoadingState label="Loading" rows={1} />}>
                <ValueCalculator />
              </Suspense>
              <SalesWorkspace />
            </div>
          </Container>
        </Section>
      </main>
      <SiteFooter />
    </>
  );
}
