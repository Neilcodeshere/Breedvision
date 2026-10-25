import type { Metadata } from "next";

import { IdentifyFlow } from "@/components/identify/IdentifyFlow";
import { Container, Section } from "@/components/layout/Container";
import { SiteFooter } from "@/components/navigation/SiteFooter";
import { SiteHeader } from "@/components/navigation/SiteHeader";
import { T } from "@/i18n";

export const metadata: Metadata = {
  title: "Identify an animal",
  description:
    "Photograph or upload an image of cattle to get a predicted breed with a confidence score.",
};

export default function IdentifyPage() {
  return (
    <>
      <SiteHeader />
      <main id="main">
        <Section spacing="tight">
          <Container width="text">
            <h1 className="text-title font-semibold tracking-tight text-ink">
              <T k="identify.title" />
            </h1>
            <p className="mt-2 max-w-lg text-body text-ink-2 text-pretty">
              <T k="identify.intro" />
            </p>
            <div className="mt-8">
              <IdentifyFlow />
            </div>
          </Container>
        </Section>
      </main>
      <SiteFooter />
    </>
  );
}
