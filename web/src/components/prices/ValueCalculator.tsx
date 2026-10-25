"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { Card } from "@/components/ui/Card";
import { Field, Input, Select } from "@/components/ui/Field";
import {
  DEFAULT_BASIS,
  PER_LITRE_INR,
  PRICE_ANCHORS,
  REFERENCE_DATE,
  REFERENCE_MILK_YIELD_LITRES,
  SOURCE_TITLE,
  SOURCE_URL,
} from "@/lib/price-anchors.generated";
import { estimateValue, formatInr } from "@/lib/price-reference";
import { getBreeds } from "@/services/breeds";
import type { BreedSummary } from "@/types";

/**
 * "What is my animal worth?" An indicative rupee estimate for a milch cow.
 *
 * It is a guide, not a quote, and the screen says so before it shows a number.
 * The estimate and its range come from a breed guide's listed prices, adjusted
 * for milk yield and pregnancy (src/lib/price-reference.ts).
 */
export function ValueCalculator() {
  const params = useSearchParams();
  const [breeds, setBreeds] = useState<BreedSummary[]>([]);
  const [breedId, setBreedId] = useState(params.get("breed") ?? "");
  const [yieldText, setYieldText] = useState("8");
  const [pregnant, setPregnant] = useState(false);

  useEffect(() => {
    void getBreeds().then((r) => r.ok && setBreeds(r.data));
  }, []);

  const litres = Number(yieldText);
  const validYield =
    yieldText.trim() !== "" && Number.isFinite(litres) && litres >= 0 && litres <= 60;

  const breed = breeds.find((b) => b.id === breedId);
  const result = useMemo(
    () =>
      breedId && validYield
        ? estimateValue({ breedId, milkYieldLitres: litres, pregnant })
        : null,
    [breedId, validYield, litres, pregnant],
  );

  return (
    <Card>
      <div className="rounded-md border border-amber/30 bg-amber-soft px-4 py-3 text-small text-ink-2">
        <strong className="font-semibold text-amber">An indicative guide, not a quote.</strong>{" "}
        Real prices depend on region, pedigree, season, age and how the sale
        goes. Use this to know the likely range before you negotiate, not as a
        price anyone has agreed to pay.
      </div>

      <div className="mt-6 grid max-w-2xl gap-4 sm:grid-cols-2">
        <Field label="Breed">
          <Select value={breedId} onChange={(e) => setBreedId(e.target.value)}>
            <option value="">Choose a breed</option>
            {breeds.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Daily milk yield (litres)"
          error={validYield ? undefined : "Enter a number from 0 to 60."}
        >
          <Input
            inputMode="decimal"
            value={yieldText}
            onChange={(e) => setYieldText(e.target.value)}
          />
        </Field>
        <label className="flex min-h-11 items-center gap-3 text-small text-ink-2 sm:col-span-2">
          <input
            type="checkbox"
            checked={pregnant}
            onChange={(e) => setPregnant(e.target.checked)}
            className="h-5 w-5 accent-forest"
          />
          The cow is pregnant
        </label>
      </div>

      {!breedId ? (
        <p className="mt-6 text-small text-ink-3">
          Choose a breed to see its estimated value. If you identified the
          animal with the camera, use “Estimate value” on the result.
        </p>
      ) : null}

      {result && breed ? (
        <div className="mt-6" role="status" aria-live="polite">
          <p className="text-micro uppercase tracking-[0.14em] text-ink-3">
            Estimated value of a {breed.name} cow
          </p>
          <p data-numeric="" className="mt-1 text-display font-semibold tracking-tight text-ink">
            {formatInr(result.typicalInr)}
          </p>
          <p data-numeric="" className="mt-1 text-body text-ink-2">
            Likely range {formatInr(result.lowInr)} – {formatInr(result.highInr)}
          </p>

          <ul className="mt-5 flex max-w-md flex-col gap-2 text-small text-ink-2">
            <li className="flex justify-between gap-4">
              <span>
                Typical {breed.name} at {REFERENCE_MILK_YIELD_LITRES} litres a day
              </span>
              <span data-numeric="">{formatInr(result.parts.baseInr)}</span>
            </li>
            <li className="flex justify-between gap-4">
              <span>
                Milk yield ({litres} L, {litres >= REFERENCE_MILK_YIELD_LITRES ? "above" : "below"}{" "}
                {REFERENCE_MILK_YIELD_LITRES} L)
              </span>
              <span data-numeric="">
                {result.parts.milkInr >= 0 ? "+" : "−"}
                {formatInr(Math.abs(result.parts.milkInr))}
              </span>
            </li>
            {pregnant ? (
              <li className="flex justify-between gap-4">
                <span>Pregnant</span>
                <span data-numeric="">+{formatInr(result.parts.pregnancyInr)}</span>
              </li>
            ) : null}
          </ul>

          <p className="mt-5 max-w-prose text-small text-ink-3 text-pretty">
            {result.sourced ? (
              <>
                Listed prices for {breed.name}:{" "}
                <span data-numeric="">
                  {formatInr(result.listing.lowInr)} – {formatInr(result.listing.highInr)}
                </span>
                {result.note ? ` ${result.note}` : ""} Source:{" "}
                <a
                  href={SOURCE_URL}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-forest underline underline-offset-2"
                >
                  {SOURCE_TITLE}
                </a>
                .
              </>
            ) : (
              <>
                <strong className="font-semibold text-ink-2">No price source found for {breed.name}.</strong>{" "}
                {DEFAULT_BASIS} The breed’s own value may be higher or lower.
              </>
            )}
          </p>
        </div>
      ) : null}

      <details className="mt-6 text-small text-ink-3">
        <summary className="cursor-pointer font-medium text-ink-2">
          How this is calculated, and its limits
        </summary>
        <div className="mt-2 flex max-w-prose flex-col gap-2 text-pretty">
          <p>
            Start from the breed’s typical price (the middle of its listed
            range). Add {formatInr(PER_LITRE_INR)} for each daily litre above{" "}
            {REFERENCE_MILK_YIELD_LITRES}, subtract it for each litre below, and
            add about 1.5 litres’ worth if she is pregnant. The listed range is
            scaled by the same amount to give the likely range.
          </p>
          <p>
            The {formatInr(PER_LITRE_INR)} per litre is an assumption taken from
            one project report (about ₹4,400 per daily litre for a crossbred
            cow), rounded down. The pregnancy figure uses only the <em>ratio</em>{" "}
            of the two effects in Kumar et al. (2014, Indian Journal of Animal
            Sciences 84(11), Table 2); that study’s own 2010–11 rupee amounts
            are not used.
          </p>
          <p>
            Prices are asking-price ranges from a breed guide read in{" "}
            {REFERENCE_DATE}, not completed sales. Only {Object.keys(PRICE_ANCHORS).length} of the 49 breeds
            have a listed range; the rest use a general desi-cow range. It assumes a
            milch cow: bulls and draught animals are priced differently, and
            pedigree or milk-record premiums are not included. Check against
            your local market before relying on it.
          </p>
        </div>
      </details>
    </Card>
  );
}
