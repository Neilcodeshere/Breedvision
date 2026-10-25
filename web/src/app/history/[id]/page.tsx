import type { Metadata } from "next";

import { RecordDetail } from "@/components/history/RecordDetail";
import { Container, Section } from "@/components/layout/Container";
import { SiteFooter } from "@/components/navigation/SiteFooter";
import { SiteHeader } from "@/components/navigation/SiteHeader";

export const metadata: Metadata = {
  title: "Identification record",
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function RecordPage({ params }: PageProps) {
  const { id } = await params;
  return (
    <>
      <SiteHeader />
      <main id="main">
        <Section spacing="tight">
          <Container>
            <RecordDetail id={id} />
          </Container>
        </Section>
      </main>
      <SiteFooter />
    </>
  );
}
