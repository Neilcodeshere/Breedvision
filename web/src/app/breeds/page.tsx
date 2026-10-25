import type { Metadata } from "next";

import { BreedLibrary } from "@/components/breed/BreedLibrary";
import { Container, Section } from "@/components/layout/Container";
import { SiteFooter } from "@/components/navigation/SiteFooter";
import { SiteHeader } from "@/components/navigation/SiteHeader";
import { ErrorState } from "@/components/states";
import { MockDataNotice } from "@/components/ui/MockDataNotice";
import { T } from "@/i18n";
import { getBreeds } from "@/services/breeds";

export const metadata: Metadata = {
  title: "Breed library",
  description:
    "Browse Indian cattle breeds covered by BreedVision.",
};

export default async function BreedsPage() {
  const result = await getBreeds();

  return (
    <>
      <SiteHeader />
      <main id="main">
        <Section spacing="tight">
          <Container>
            <h1 className="text-title font-semibold tracking-tight text-ink">
              <T k="breeds.title" />
            </h1>
            <p className="mt-2 max-w-xl text-body text-ink-2 text-pretty">
              <T k="breeds.intro" />
            </p>

            <MockDataNotice
              className="mt-6"
              what={<T k="breeds.mockWhat" />}
            />

            <div className="mt-8">
              {result.ok ? (
                <BreedLibrary breeds={result.data} />
              ) : (
                <ErrorState
                  title={<T k="breeds.loadFail" />}
                  description={result.error.message}
                />
              )}
            </div>
          </Container>
        </Section>
      </main>
      <SiteFooter />
    </>
  );
}
