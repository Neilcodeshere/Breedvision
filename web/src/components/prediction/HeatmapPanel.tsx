"use client";

import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { useT } from "@/i18n";
import { EXPLAIN_AVAILABLE, explainPrediction, type Explanation } from "@/services/explain";

/**
 * "Where did the model look?" — evidence regions, never anatomy.
 *
 * The wording matters as much as the picture. It says the model *found
 * evidence in* a region; it never says the model looked at horns, a hump or a
 * coat, because the map shows image regions and cannot tell us which features
 * those regions contain.
 */
export function HeatmapPanel({ file }: { file: File }) {
  const t = useT();
  const [state, setState] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const [data, setData] = useState<Explanation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showHeat, setShowHeat] = useState(true);

  if (!EXPLAIN_AVAILABLE) {
    return (
      <p className="text-micro text-ink-3">{t("heat.unavailable")}</p>
    );
  }

  const load = async () => {
    setState("loading");
    setError(null);
    const r = await explainPrediction(file);
    if (r.ok) {
      setData(r.data);
      setState("ready");
    } else {
      setError(r.error.message);
      setState("failed");
    }
  };

  if (state === "idle" || state === "failed") {
    return (
      <div className="flex flex-col gap-2">
        <div>
          <Button variant="secondary" size="md" onClick={load}>
            {t("heat.show")}
          </Button>
        </div>
        {error ? <p role="alert" className="text-small text-clay">{error}</p> : null}
      </div>
    );
  }

  if (state === "loading" || !data) {
    return <p role="status" className="text-small text-ink-3">{t("heat.working")}</p>;
  }

  return (
    <figure className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
      <div className="relative mx-auto aspect-square w-full max-w-sm overflow-hidden rounded-md bg-cream">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={data.viewUrl} alt="" className="absolute inset-0 h-full w-full" />
        {showHeat ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={data.heatmapUrl} alt="" className="absolute inset-0 h-full w-full" />
        ) : null}
        <span className="sr-only">
          {`Heat-map for ${data.breedName}. ${data.summary}`}
        </span>
      </div>

      <figcaption className="flex flex-col gap-2 text-small text-ink-2">
        <p>
          <strong className="font-semibold text-ink">{data.breedName}:</strong> {data.summary}{" "}
          {t("heat.darker")}
        </p>

        <label className="flex min-h-11 cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={showHeat}
            onChange={(e) => setShowHeat(e.target.checked)}
            className="h-5 w-5 accent-forest"
          />
          {t("heat.toggle")}
        </label>

        <p className="text-micro text-ink-3 text-pretty">
          {t("heat.note")}
        </p>

        <details className="text-micro text-ink-3">
          <summary className="cursor-pointer font-medium text-ink-2">{t("heat.limits")}</summary>
          <ul className="mt-2 list-disc pl-5">
            {data.limits.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </details>
      </figcaption>
    </figure>
  );
}
