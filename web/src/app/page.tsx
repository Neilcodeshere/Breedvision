import { Container, Section, SectionHeading } from "@/components/layout/Container";
import { ProductVisual } from "@/components/marketing/ProductVisual";
import { SiteFooter } from "@/components/navigation/SiteFooter";
import { SiteHeader } from "@/components/navigation/SiteHeader";
import { ButtonLink } from "@/components/ui/Button";
import { T } from "@/i18n";

const STEPS = [1, 2, 3, 4] as const;
const PROBLEMS = [1, 2, 3] as const;
const RESULT_POINTS = [1, 2, 3] as const;

export default function HomePage() {
  return (
    <>
      <SiteHeader />
      <main id="main">
        {/* ------------------------------------------------------------ hero */}
        <Section spacing="loose" className="pb-16 sm:pb-20">
          <Container>
            <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:gap-16">
              <div>
                <p className="text-micro font-semibold uppercase tracking-[0.16em] text-ink-3">
                  BreedVision
                </p>
                <h1 className="mt-5 text-display font-semibold tracking-tight text-balance text-ink">
                  <T k="home.title" />
                </h1>
                <p className="mt-6 max-w-lg text-lead text-ink-2 text-pretty">
                  <T k="home.lead" />
                </p>
                <div className="mt-9 flex flex-wrap gap-3">
                  <ButtonLink href="/identify" size="lg">
                    <T k="nav.identify" />
                  </ButtonLink>
                  <ButtonLink href="/breeds" size="lg" variant="secondary">
                    <T k="home.exploreBreeds" />
                  </ButtonLink>
                </div>
                <p className="mt-8 max-w-md text-small text-ink-3 text-pretty">
                  <T k="home.note" />
                </p>
              </div>

              <ProductVisual className="lg:ml-auto lg:max-w-md" />
            </div>
          </Container>
        </Section>

        {/* --------------------------------------------------------- problem */}
        <Section tone="sunk">
          <Container>
            <SectionHeading
              eyebrow={<T k="home.problem.eyebrow" />}
              title={<T k="home.problem.title" />}
              description={<T k="home.problem.desc" />}
            />
            <div className="mt-12 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
              {PROBLEMS.map((n) => (
                <div key={n} className="border-t border-line-strong pt-5">
                  <h3 className="text-body font-semibold text-ink">
                    <T k={`home.problem.${n}.title` as const} />
                  </h3>
                  <p className="mt-2 text-small text-ink-2 text-pretty">
                    <T k={`home.problem.${n}.body` as const} />
                  </p>
                </div>
              ))}
            </div>
          </Container>
        </Section>

        {/* ---------------------------------------------------- how it works */}
        <Section>
          <Container>
            <SectionHeading
              eyebrow={<T k="home.how.eyebrow" />}
              title={<T k="home.how.title" />}
            />

            <ol className="mt-14 grid gap-x-8 gap-y-12 sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map((n, i) => (
                <li key={n} className="relative">
                  {/* Connector: drawn only between steps on wide screens. */}
                  {i < STEPS.length - 1 ? (
                    <span
                      aria-hidden="true"
                      // Starts at the dot's centre and spans the 2rem column
                      // gap, so the line reads as continuous across all four.
                      className="absolute left-2.5 top-2.5 hidden h-px w-[calc(100%+2rem)] bg-line-strong lg:block"
                    />
                  ) : null}
                  <span
                    aria-hidden="true"
                    className="relative block h-5 w-5 rounded-full border-2 border-forest bg-paper"
                  />
                  <p
                    data-numeric=""
                    className="mt-5 text-micro font-semibold tracking-[0.14em] text-forest"
                  >
                    {String(n).padStart(2, "0")}
                  </p>
                  <h3 className="mt-1.5 text-title font-semibold tracking-tight text-ink">
                    <T k={`home.step.${n}.title` as const} />
                  </h3>
                  <p className="mt-2.5 text-small text-ink-2 text-pretty">
                    <T k={`home.step.${n}.body` as const} />
                  </p>
                </li>
              ))}
            </ol>
          </Container>
        </Section>

        {/* -------------------------------------------------- product preview */}
        <Section tone="sunk">
          <Container>
            <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:gap-16">
              <ProductVisual className="order-2 lg:order-1 lg:max-w-md" />

              <div className="order-1 lg:order-2">
                <SectionHeading
                  eyebrow={<T k="home.result.eyebrow" />}
                  title={<T k="home.result.title" />}
                  description={<T k="home.result.desc" />}
                />
                <dl className="mt-10 flex flex-col gap-7">
                  {RESULT_POINTS.map((n) => (
                    <div key={n} className="border-t border-line-strong pt-4">
                      <dt className="text-body font-semibold text-ink">
                        <T k={`home.result.${n}.t` as const} />
                      </dt>
                      <dd className="mt-1.5 text-small text-ink-2 text-pretty">
                        <T k={`home.result.${n}.d` as const} />
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>
          </Container>
        </Section>

        {/* ------------------------------------------------------------- cta */}
        <Section spacing="tight">
          <Container width="text">
            <div className="flex flex-col items-start gap-6 border-t border-line pt-14 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-title font-semibold tracking-tight text-ink">
                  <T k="home.cta.title" />
                </h2>
                <p className="mt-2 text-body text-ink-2">
                  <T k="home.cta.body" />
                </p>
              </div>
              <ButtonLink href="/identify" size="lg" className="shrink-0">
                <T k="nav.identify" />
              </ButtonLink>
            </div>
          </Container>
        </Section>
      </main>
      <SiteFooter />
    </>
  );
}
