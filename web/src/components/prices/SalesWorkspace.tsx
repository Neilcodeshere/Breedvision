"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field, Input, Select } from "@/components/ui/Field";
import { median, rankBy, valueIndex } from "@/lib/valuation";
import { getBreeds } from "@/services/breeds";
import {
  addSale,
  listSales,
  loadDemoSales,
  removeDemoSales,
  removeSale,
  type SaleRecord,
} from "@/services/sales";
import type { BreedSummary } from "@/types";

/** Real sales needed in a breed before an observed median is shown. */
const MIN_REAL_SALES = 5;

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

function quarterKey(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  return `${y} Q${Math.ceil(m / 3)}`;
}

/** Quarterly median price as a plain SVG line. No chart library needed. */
function HistoryChart({ sales }: { sales: SaleRecord[] }) {
  const points = useMemo(() => {
    const byQ = new Map<string, number[]>();
    sales.forEach((s) => {
      const k = quarterKey(s.soldOn);
      byQ.set(k, [...(byQ.get(k) ?? []), s.priceInr]);
    });
    return [...byQ.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([q, v]) => ({ q, v: median(v) as number, n: v.length }));
  }, [sales]);

  if (points.length < 3) {
    return (
      <p className="text-small text-ink-3">
        A history line needs sales from at least 3 different quarters.
      </p>
    );
  }

  const W = 640;
  const H = 220;
  const pad = { l: 64, r: 12, t: 12, b: 28 };
  const lo = Math.min(...points.map((p) => p.v));
  const hi = Math.max(...points.map((p) => p.v));
  const span = hi - lo || 1;
  const x = (i: number) =>
    pad.l + (i / (points.length - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - lo) / span) * (H - pad.t - pad.b);
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.v)}`).join(" ");
  const step = Math.ceil(points.length / 7);

  return (
    <figure>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={`Median sale price by quarter, from ${points[0].q} to ${points[points.length - 1].q}, ranging ${inr(lo)} to ${inr(hi)}`}
      >
        {[lo, (lo + hi) / 2, hi].map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} className="stroke-line" />
            <text x={pad.l - 8} y={y(v) + 4} textAnchor="end" className="fill-ink-3 text-[11px]">
              {inr(v)}
            </text>
          </g>
        ))}
        <path d={path} fill="none" className="stroke-forest" strokeWidth="2" />
        {points.map((p, i) => (
          <g key={p.q}>
            <circle cx={x(i)} cy={y(p.v)} r="3" className="fill-forest" />
            {i % step === 0 ? (
              <text x={x(i)} y={H - 8} textAnchor="middle" className="fill-ink-3 text-[11px]">
                {p.q}
              </text>
            ) : null}
          </g>
        ))}
      </svg>
      <figcaption className="mt-1 text-micro text-ink-3">
        Median of all sales in each quarter. Animals differ in yield and
        pregnancy, so this is a trend indicator, not a like-for-like price.
      </figcaption>
    </figure>
  );
}

// Note: the table wrapper below is `relative` on purpose. Its header contains an
// `sr-only` (absolutely positioned) label, which otherwise escapes the scroll
// container and widens the whole page on phones.
export function SalesWorkspace() {
  const [sales, setSales] = useState<SaleRecord[] | null>(null);
  const [breeds, setBreeds] = useState<BreedSummary[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [breedId, setBreedId] = useState("");
  const [price, setPrice] = useState("");
  const [soldOn, setSoldOn] = useState("");
  const [yieldText, setYieldText] = useState("");
  const [pregnant, setPregnant] = useState(false);
  const [ageText, setAgeText] = useState("");
  const [formError, setFormError] = useState<string | undefined>();

  const refresh = useCallback(async () => {
    const r = await listSales();
    if (r.ok) setSales(r.data);
    else {
      setLoadError(r.error.message);
      setSales([]);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    void getBreeds().then((r) => r.ok && setBreeds(r.data));
  }, [refresh]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(undefined);
    const breed = breeds.find((b) => b.id === breedId);
    const num = (t: string) => (t.trim() === "" ? null : Number(t));
    const r = await addSale({
      breedId,
      breedName: breed?.name ?? "",
      priceInr: Number(price),
      soldOn,
      milkYieldLitres: num(yieldText),
      pregnant: yieldText.trim() === "" && !pregnant ? null : pregnant,
      ageYears: num(ageText),
      note: null,
    });
    if (!r.ok) {
      setFormError(r.error.message);
      return;
    }
    setPrice("");
    setYieldText("");
    setPregnant(false);
    setAgeText("");
    setNotice("Sale logged on this device.");
    await refresh();
  };

  const run = async (fn: () => Promise<{ ok: boolean }>, done: string) => {
    setBusy(true);
    const r = await fn();
    setNotice(r.ok ? done : "That didn’t work. Try again.");
    await refresh();
    setBusy(false);
  };

  const visible = useMemo(
    () => (sales ?? []).filter((s) => filter === "all" || s.breedId === filter),
    [sales, filter],
  );

  const scored = useMemo(
    () =>
      visible
        .filter((s) => s.milkYieldLitres !== null)
        .map((s) => ({
          sale: s,
          index: valueIndex({
            milkYieldLitres: s.milkYieldLitres as number,
            pregnant: s.pregnant === true,
          }).index,
        })),
    [visible],
  );
  const ranks = useMemo(() => rankBy(scored, (r) => r.index), [scored]);
  const ranked = useMemo(
    () => [...scored].sort((a, b) => (ranks.get(a) ?? 0) - (ranks.get(b) ?? 0)),
    [scored, ranks],
  );

  const realByBreed = useMemo(() => {
    const m = new Map<string, { name: string; prices: number[] }>();
    (sales ?? [])
      .filter((s) => s.source === "user")
      .forEach((s) => {
        const e = m.get(s.breedId) ?? { name: s.breedName, prices: [] };
        e.prices.push(s.priceInr);
        m.set(s.breedId, e);
      });
    return [...m.entries()].sort((a, b) => b[1].prices.length - a[1].prices.length);
  }, [sales]);

  if (sales === null) return <LoadingState label="Loading sale prices" rows={2} />;
  if (loadError) return <ErrorState title="Sales could not be read" description={loadError} />;

  const demoCount = sales.filter((s) => s.source === "synthetic").length;
  const realCount = sales.length - demoCount;

  return (
    <div className="flex flex-col gap-10">
      {demoCount > 0 ? (
        <div className="rounded-md border border-terracotta/30 bg-terracotta-soft px-4 py-3 text-small text-ink-2">
          <strong className="font-semibold text-terracotta">Illustrative data.</strong>{" "}
          {demoCount} rows below are <strong>synthetic</strong>: generated
          around the listed price ranges the estimator uses, with an assumed
          trend. They are not real sales, are excluded from the observed prices
          section, and can never be uploaded.
        </div>
      ) : null}

      <Card>
        <h2 className="text-title font-semibold tracking-tight text-ink">Log a sale</h2>
        <p className="mt-2 max-w-prose text-small text-ink-2 text-pretty">
          Real sale prices are the data this project is missing. Each one you
          record helps build an honest price reference, and is never mixed with
          the illustrative sales. Stored on this device only.
        </p>
        <form onSubmit={submit} className="mt-5 grid gap-4 sm:grid-cols-2">
          <Field label="Breed">
            <Select value={breedId} onChange={(e) => setBreedId(e.target.value)} required>
              <option value="">Choose a breed</option>
              {breeds.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Sale price (₹)" hint="Whole rupees.">
            <Input inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} required />
          </Field>
          <Field label="Date sold">
            <Input type="date" value={soldOn} onChange={(e) => setSoldOn(e.target.value)} required />
          </Field>
          <Field label="Daily milk yield (litres)" hint="Optional. Needed for ranking.">
            <Input inputMode="decimal" value={yieldText} onChange={(e) => setYieldText(e.target.value)} />
          </Field>
          <Field label="Age (years)" hint="Optional.">
            <Input inputMode="numeric" value={ageText} onChange={(e) => setAgeText(e.target.value)} />
          </Field>
          <label className="flex min-h-11 items-center gap-3 self-end text-small text-ink-2">
            <input type="checkbox" checked={pregnant} onChange={(e) => setPregnant(e.target.checked)} className="h-5 w-5 accent-forest" />
            Animal was pregnant
          </label>
          <div className="sm:col-span-2">
            {formError ? <p role="alert" className="mb-3 text-small text-clay">{formError}</p> : null}
            <Button type="submit" size="lg">Save sale</Button>
          </div>
        </form>
      </Card>

      <section aria-labelledby="log-h" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="log-h" className="text-title font-semibold tracking-tight text-ink">
            Sales ranked by value index
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <Select aria-label="Filter by breed" value={filter} onChange={(e) => setFilter(e.target.value)} className="w-48">
              <option value="all">All breeds</option>
              {breeds.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </Select>
            {demoCount === 0 ? (
              <Button variant="secondary" size="sm" disabled={busy}
                onClick={() => run(loadDemoSales, "Illustrative sales loaded. They are synthetic.")}>
                Load illustrative sales
              </Button>
            ) : (
              <Button variant="secondary" size="sm" disabled={busy}
                onClick={() => run(removeDemoSales, "Illustrative sales removed.")}>
                Remove illustrative sales
              </Button>
            )}
          </div>
        </div>

        <p role="status" aria-live="polite" className="text-micro text-ink-3">
          {notice ?? `${realCount} real, ${demoCount} illustrative.`}
        </p>

        {sales.length === 0 ? (
          <EmptyState
            title="No sales logged yet"
            description="Log a sale above, or load the illustrative sales to see how ranking and history look."
          />
        ) : ranked.length === 0 ? (
          <p className="text-small text-ink-3">
            None of these sales include a milk yield, so they can’t be ranked.
          </p>
        ) : (
          <div className="relative overflow-x-auto rounded-lg border border-line bg-surface">
            <table className="w-full min-w-[34rem] text-left text-small">
              <caption className="sr-only">Sales ranked by relative value index</caption>
              <thead className="border-b border-line bg-paper-sunk text-micro uppercase tracking-[0.1em] text-ink-3">
                <tr>
                  <th scope="col" className="px-3 py-2">Rank</th>
                  <th scope="col" className="px-3 py-2">Breed</th>
                  <th scope="col" className="px-3 py-2">Index</th>
                  <th scope="col" className="px-3 py-2">Sold for</th>
                  <th scope="col" className="px-3 py-2">Date</th>
                  <th scope="col" className="px-3 py-2"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line text-ink-2">
                {ranked.slice(0, 50).map((r) => (
                  <tr key={r.sale.id}>
                    <td data-numeric="" className="px-3 py-2">{ranks.get(r)}</td>
                    <td className="px-3 py-2">
                      {r.sale.breedName}{" "}
                      {r.sale.source === "synthetic" ? <Badge tone="terracotta">Illustrative</Badge> : null}
                    </td>
                    <td data-numeric="" className="px-3 py-2">{r.index.toFixed(1)}</td>
                    <td data-numeric="" className="px-3 py-2">{inr(r.sale.priceInr)}</td>
                    <td data-numeric="" className="px-3 py-2">{r.sale.soldOn}</td>
                    <td className="px-3 py-2 text-right">
                      <Button variant="quiet" size="sm" disabled={busy}
                        aria-label={`Delete ${r.sale.breedName} sale of ${r.sale.soldOn}`}
                        onClick={() => run(() => removeSale(r.sale.id), "Sale deleted.")}>
                        Delete
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {ranked.length > 50 ? (
          <p className="text-micro text-ink-3">Showing the top 50 of {ranked.length}.</p>
        ) : null}
      </section>

      <section aria-labelledby="hist-h" className="flex flex-col gap-3">
        <h2 id="hist-h" className="text-title font-semibold tracking-tight text-ink">Price history</h2>
        <HistoryChart sales={visible} />
      </section>

      <section aria-labelledby="obs-h" className="flex flex-col gap-3">
        <h2 id="obs-h" className="text-title font-semibold tracking-tight text-ink">Observed prices (real sales only)</h2>
        {realByBreed.length === 0 ? (
          <p className="text-small text-ink-3">No real sales logged yet. Illustrative rows are never counted here.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {realByBreed.map(([id, e]) => (
              <li key={id} className="rounded-lg border border-line bg-surface p-4">
                <p className="font-semibold text-ink">{e.name}</p>
                {e.prices.length >= MIN_REAL_SALES ? (
                  <p data-numeric="" className="mt-1 text-small text-ink-2">
                    Median {inr(median(e.prices) as number)} from {e.prices.length} logged sales
                  </p>
                ) : (
                  <p className="mt-1 text-small text-ink-3">
                    {e.prices.length} of {MIN_REAL_SALES} sales needed before a median is shown.
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
