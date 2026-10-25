"use client";

import Link from "next/link";

import { ConfidenceIndicator } from "@/components/prediction/ConfidenceIndicator";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { useT } from "@/i18n";
import { cn } from "@/lib/cn";
import { bandForPrediction, formatConfidence } from "@/lib/confidence";
import type { Prediction } from "@/types";

interface CandidateRowProps {
  name: string;
  breedId: string;
  probability: number;
  /** Emphasised when the band is uncertain and no single breed is asserted. */
  emphasis?: boolean;
}

function CandidateRow({
  name,
  breedId,
  probability,
  emphasis,
}: CandidateRowProps) {
  return (
    <li className="flex items-center gap-3 py-2.5">
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 shrink-0 rounded-full bg-ink-4"
      />
      <Link
        href={`/breeds/${breedId}`}
        className={cn(
          "min-w-0 flex-1 truncate underline-offset-2 hover:underline",
          emphasis ? "text-body font-medium text-ink" : "text-body text-ink-2",
        )}
      >
        {name}
      </Link>
      <span
        data-numeric=""
        className="shrink-0 text-small tabular-nums text-ink-3"
      >
        {formatConfidence(probability)}
      </span>
    </li>
  );
}

interface PredictionResultProps {
  prediction: Prediction;
  /**
   * Heading level for the result headline. Defaults to `h2` for pages that own
   * their own `h1` (the identify flow). Pass `h1` where this result *is* the
   * page's subject, such as a saved record — every page needs exactly one h1.
   */
  headingLevel?: "h1" | "h2";
  className?: string;
}

/**
 * Renders a prediction according to its confidence band.
 *
 * The band — not the raw number — decides what the interface is willing to
 * claim. When the model is not confident, no single breed is presented as the
 * answer, however tempting the top-1 label is. That rule is the whole point of
 * this component.
 */
export function PredictionResult({
  prediction,
  headingLevel = "h2",
  className,
}: PredictionResultProps) {
  const t = useT();
  const Heading = headingLevel;
  // Nested headings follow the parent so the outline never skips a level.
  const SubHeading = headingLevel === "h1" ? "h2" : "h3";
  const band = bandForPrediction(prediction);
  const notCattle = prediction.looksLikeCattle === false;

  // Uncertain: the top-1 belongs in the candidate list, not in the headline.
  const candidates =
    band === "confident"
      ? prediction.alternatives
      : [
          {
            breedId: prediction.breedId,
            breedName: prediction.breedName,
            probability: prediction.confidence,
          },
          ...prediction.alternatives,
        ];

  if (notCattle) {
    // The photo is unlike any cattle photo the model was fitted on, so the
    // top breed would be a guess about something that is not in its world.
    return (
      <div className={cn("flex flex-col gap-6", className)}>
        <header>
          <Badge tone="clay">{t("notcattle.badge")}</Badge>
          <Heading className="mt-3 text-title font-semibold tracking-tight text-balance text-ink">
            {t("notcattle.title")}
          </Heading>
          <p className="mt-3 max-w-md text-body text-ink-2 text-pretty">
            {t("notcattle.body")}
          </p>
        </header>
        <Card variant="sunk">
          <SubHeading className="text-small font-semibold text-ink">
            {t("pred.helps.title")}
          </SubHeading>
          <ul className="mt-3 flex flex-col gap-2 text-small text-ink-2">
            <li>{t("pred.helps.1")}</li>
            <li>{t("pred.helps.2")}</li>
            <li>{t("pred.helps.3")}</li>
            <li>{t("pred.helps.4")}</li>
          </ul>
        </Card>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-6", className)}>
      {band === "confident" ? (
        <header>
          <p className="text-micro font-semibold uppercase tracking-[0.14em] text-ink-3">
            {t("pred.predicted")}
          </p>
          {/* Visual size comes from the type token and is independent of the
              heading level, so the outline stays correct on every page. */}
          <Heading className="mt-2 text-display font-semibold tracking-tight text-ink">
            {prediction.breedName}
          </Heading>
          <div className="mt-5 max-w-sm">
            <ConfidenceIndicator value={prediction.confidence} />
          </div>
        </header>
      ) : (
        <header>
          <Badge tone={band === "uncertain" ? "amber" : "clay"}>
            {t(`band.${band}.label` as const)}
          </Badge>
          <Heading className="mt-3 text-title font-semibold tracking-tight text-balance text-ink">
            {band === "uncertain"
              ? t("pred.uncertainTitle")
              : t("pred.lowTitle")}
          </Heading>
          <p className="mt-3 max-w-md text-body text-ink-2 text-pretty">
            {t(`band.${band}.desc` as const)}
          </p>
        </header>
      )}

      {band !== "low" ? (
        <Card variant={band === "confident" ? "outlined" : "raised"}>
          <SubHeading className="text-small font-semibold text-ink">
            {band === "confident" ? t("pred.other") : t("pred.possible")}
          </SubHeading>
          {band !== "confident" ? (
            <p className="mt-1 text-small text-ink-3">
              {t("pred.noneConfirmed")}
            </p>
          ) : null}
          <ul className="mt-2 divide-y divide-line">
            {candidates.slice(0, 5).map((alt) => (
              <CandidateRow
                key={alt.breedId}
                breedId={alt.breedId}
                name={alt.breedName}
                probability={alt.probability}
                emphasis={band === "uncertain"}
              />
            ))}
          </ul>
        </Card>
      ) : null}

      {band === "low" ? (
        <Card variant="sunk">
          <SubHeading className="text-small font-semibold text-ink">
            {t("pred.helps.title")}
          </SubHeading>
          <ul className="mt-3 flex flex-col gap-2 text-small text-ink-2">
            <li>{t("pred.helps.1")}</li>
            <li>{t("pred.helps.2")}</li>
            <li>{t("pred.helps.3")}</li>
            <li>{t("pred.helps.4")}</li>
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
