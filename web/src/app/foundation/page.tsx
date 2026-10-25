import type { Metadata } from "next";

import { Container, Rule, Section } from "@/components/layout/Container";
import { SiteFooter } from "@/components/navigation/SiteFooter";
import { SiteHeader } from "@/components/navigation/SiteHeader";
import { ConfidenceIndicator } from "@/components/prediction/ConfidenceIndicator";
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { Badge, Eyebrow } from "@/components/ui/Badge";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import {
  DEFAULT_THRESHOLDS,
  THRESHOLDS_ARE_PROVISIONAL,
  THRESHOLD_BASIS,
} from "@/lib/confidence";

export const metadata: Metadata = {
  title: "Design foundation",
  robots: { index: false, follow: false },
};

const SWATCHES: { group: string; items: { name: string; className: string }[] }[] =
  [
    {
      group: "Surfaces",
      items: [
        { name: "paper", className: "bg-paper" },
        { name: "paper-sunk", className: "bg-paper-sunk" },
        { name: "surface", className: "bg-surface" },
        { name: "cream", className: "bg-cream" },
      ],
    },
    {
      group: "Ink",
      items: [
        { name: "ink", className: "bg-ink" },
        { name: "ink-2", className: "bg-ink-2" },
        { name: "ink-3", className: "bg-ink-3" },
        { name: "ink-4", className: "bg-ink-4" },
      ],
    },
    {
      group: "Forest (action + confident)",
      items: [
        { name: "forest", className: "bg-forest" },
        { name: "forest-deep", className: "bg-forest-deep" },
        { name: "forest-mid", className: "bg-forest-mid" },
        { name: "forest-soft", className: "bg-forest-soft" },
      ],
    },
    {
      group: "Accent & confidence ramp",
      items: [
        { name: "terracotta", className: "bg-terracotta" },
        { name: "amber (uncertain)", className: "bg-amber" },
        { name: "clay (low / error)", className: "bg-clay" },
        { name: "line", className: "bg-line" },
      ],
    },
  ];

function Block({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-5">
      <div>
        <h2 className="text-title font-semibold text-ink">{title}</h2>
        {description ? (
          <p className="mt-1.5 max-w-2xl text-body text-ink-3">{description}</p>
        ) : null}
      </div>
      {children}
      <Rule className="mt-4" />
    </section>
  );
}

export default function FoundationPage() {
  return (
    <>
      <SiteHeader />
      <main id="main">
        <Section spacing="tight">
          <Container>
            <Eyebrow>Internal</Eyebrow>
            <h1 className="mt-3 text-display font-semibold tracking-tight text-balance text-ink">
              Design foundation
            </h1>
            <p className="mt-4 max-w-2xl text-lead text-ink-2 text-pretty">
              The token set, base components and states that the rest of
              BreedVision is built from. This page is a working reference, not
              a product screen.
            </p>

            <div className="mt-12 flex flex-col gap-14">
              {/* ---------------------------------------------- colour */}
              <Block
                title="Colour"
                description="Warm paper and charcoal carry the interface. Forest green is reserved for the primary action and the confident state, so it keeps its meaning wherever it appears."
              >
                <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
                  {SWATCHES.map((group) => (
                    <div key={group.group}>
                      <h3 className="text-micro font-semibold uppercase tracking-[0.14em] text-ink-3">
                        {group.group}
                      </h3>
                      <ul className="mt-3 flex flex-col gap-2">
                        {group.items.map((s) => (
                          <li key={s.name} className="flex items-center gap-3">
                            <span
                              className={`h-8 w-8 shrink-0 rounded-sm border border-line ${s.className}`}
                            />
                            <code className="text-micro text-ink-2">
                              {s.name}
                            </code>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </Block>

              {/* ------------------------------------------ typography */}
              <Block
                title="Typography"
                description="Inter throughout. Hierarchy comes from size and weight rather than from colour or containers."
              >
                <div className="flex flex-col gap-6">
                  <div>
                    <p className="text-micro text-ink-4">Display · 40–64px fluid</p>
                    <p className="text-display font-semibold tracking-tight text-ink">
                      Identify the breed
                    </p>
                  </div>
                  <div>
                    <p className="text-micro text-ink-4">Section · 30–40px fluid</p>
                    <p className="text-section font-semibold text-ink">
                      Built for field conditions
                    </p>
                  </div>
                  <div>
                    <p className="text-micro text-ink-4">Title · 26–36px fluid</p>
                    <p className="text-title font-semibold text-ink">
                      Recent identifications
                    </p>
                  </div>
                  <div>
                    <p className="text-micro text-ink-4">Lead · 18px</p>
                    <p className="max-w-xl text-lead text-ink-2">
                      Photograph an animal and receive a predicted breed with a
                      confidence score.
                    </p>
                  </div>
                  <div>
                    <p className="text-micro text-ink-4">Body · 16px</p>
                    <p className="max-w-xl text-body text-ink">
                      The model compares the image against breeds it was trained
                      on and reports how certain it is. Results are advisory.
                    </p>
                  </div>
                  <div>
                    <p className="text-micro text-ink-4">
                      Small · 14px / Micro · 13px
                    </p>
                    <p className="text-small text-ink-2">
                      Captured 14 March 2026, 09:42
                    </p>
                    <p className="text-micro uppercase tracking-[0.14em] text-ink-3">
                      Model version
                    </p>
                  </div>
                </div>
              </Block>

              {/* --------------------------------------------- buttons */}
              <Block
                title="Buttons"
                description="Medium and large sizes clear a 44px touch target. The large size is the default for the primary field action."
              >
                <div className="flex flex-col gap-6">
                  <div className="flex flex-wrap items-center gap-3">
                    <Button size="lg">Identify an animal</Button>
                    <Button variant="secondary" size="lg">
                      Upload image
                    </Button>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <Button>Analyse breed</Button>
                    <Button variant="secondary">Retake photo</Button>
                    <Button variant="quiet">Cancel</Button>
                    <Button variant="danger">Delete record</Button>
                    <Button disabled>Unavailable</Button>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <Button size="sm">Save record</Button>
                    <Button variant="secondary" size="sm">
                      View breed
                    </Button>
                    <ButtonLink href="/foundation" variant="quiet" size="sm">
                      Link styled as button
                    </ButtonLink>
                  </div>
                  <div className="max-w-sm">
                    <Button size="lg" block>
                      Full-width field action
                    </Button>
                  </div>
                </div>
              </Block>

              {/* ---------------------------------------------- badges */}
              <Block title="Tags and labels">
                <div className="flex flex-wrap items-center gap-2.5">
                  <Badge tone="neutral">Cattle</Badge>
                  <Badge tone="forest">Confident match</Badge>
                  <Badge tone="amber">Uncertain</Badge>
                  <Badge tone="clay">Not identified</Badge>
                  <Badge tone="terracotta">Buffalo</Badge>
                </div>
              </Block>

              {/* ------------------------------------------ confidence */}
              <Block
                title="Confidence"
                description="Three redundant channels — written band, segmented fill, and the number — so the reading never depends on colour alone."
              >
                <div className="rounded-md border border-line bg-paper-sunk px-4 py-3">
                  <p className="text-small text-ink-2">
                    <strong className="font-semibold text-ink">
                      {THRESHOLDS_ARE_PROVISIONAL
                        ? "Provisional thresholds."
                        : `Confident at ${DEFAULT_THRESHOLDS.confident * 100}%, uncertain from ${DEFAULT_THRESHOLDS.uncertain * 100}%.`}
                    </strong>{" "}
                    {THRESHOLD_BASIS}
                  </p>
                </div>
                <div className="grid gap-6 sm:grid-cols-3">
                  <Card>
                    <ConfidenceIndicator value={0.914} />
                  </Card>
                  <Card>
                    <ConfidenceIndicator value={0.523} />
                  </Card>
                  <Card>
                    <ConfidenceIndicator value={0.246} />
                  </Card>
                </div>
              </Block>

              {/* ----------------------------------------------- forms */}
              <Block
                title="Form controls"
                description="Labels are always present and always associated. Errors say what happened and what to do."
              >
                <div className="grid max-w-3xl gap-5 sm:grid-cols-2">
                  <Field label="Search breeds" hint="Try a breed or region name.">
                    <Input placeholder="e.g. Gir" />
                  </Field>
                  <Field label="Category">
                    <Select defaultValue="">
                      <option value="">All animals</option>
                      <option value="cattle">Cattle</option>
                      <option value="buffalo">Buffalo</option>
                    </Select>
                  </Field>
                  <Field
                    label="Email"
                    error="Enter an email address that includes an @ symbol."
                  >
                    <Input defaultValue="field.officer" />
                  </Field>
                  <Field label="Field note" hint="Optional.">
                    <Textarea placeholder="Anything worth recording" />
                  </Field>
                </div>
              </Block>

              {/* ----------------------------------------------- cards */}
              <Block
                title="Containers"
                description="Used sparingly. Editorial layouts should reach for plain first — hierarchy comes from spacing, not from boxes."
              >
                <div className="grid gap-5 sm:grid-cols-3">
                  <Card>
                    <CardHeader
                      title="Outlined"
                      description="The default. One warm hairline."
                    />
                  </Card>
                  <Card variant="sunk">
                    <CardHeader
                      title="Sunk"
                      description="A recessed well inside another surface."
                    />
                  </Card>
                  <Card variant="raised">
                    <CardHeader
                      title="Raised"
                      description="For content that genuinely floats."
                    />
                  </Card>
                </div>
              </Block>

              {/* ---------------------------------------------- states */}
              <Block
                title="Loading, empty and error states"
                description="Every screen needs all three. Error copy never says “Something went wrong”."
              >
                <div className="grid gap-5 lg:grid-cols-3">
                  <LoadingState label="Loading identifications" rows={2} />
                  <EmptyState
                    title="No identifications yet"
                    description="Photograph an animal to create your first record."
                    action={<Button size="sm">Identify an animal</Button>}
                  />
                  <ErrorState
                    description="The image could not be analysed. Try a clearer photo showing most of the animal."
                    retryLabel="Try another photo"
                  />
                </div>
              </Block>
            </div>
          </Container>
        </Section>
      </main>
      <SiteFooter />
    </>
  );
}
