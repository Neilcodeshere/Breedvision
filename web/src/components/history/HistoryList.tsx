"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { Badge } from "@/components/ui/Badge";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Field, Select } from "@/components/ui/Field";
import { useDateTag, useT } from "@/i18n";
import { cn } from "@/lib/cn";
import { bandFor, formatConfidence } from "@/lib/confidence";
import { recordsToCsv } from "@/lib/csv";
import { listRecords, type LocalRecord } from "@/services/records";
import type { ConfidenceBand } from "@/types";

type DateFilter = "all" | "today" | "7d" | "30d";
type BandFilter = "all" | ConfidenceBand;

const BAND_TONE: Record<ConfidenceBand, "forest" | "amber" | "clay"> = {
  confident: "forest",
  uncertain: "amber",
  low: "clay",
};

function cutoffFor(filter: DateFilter): number {
  const now = Date.now();
  switch (filter) {
    case "today": {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    }
    case "7d":
      return now - 7 * 864e5;
    case "30d":
      return now - 30 * 864e5;
    default:
      return 0;
  }
}

function RecordCard({ record }: { record: LocalRecord }) {
  const t = useT();
  const dateTag = useDateTag();
  const band = bandFor(record.prediction.confidence);
  const notCattle = record.prediction.looksLikeCattle === false;
  const asserts = band === "confident" && !notCattle;

  return (
    <li>
      <Link
        href={`/history/${record.id}`}
        className="group flex gap-4 rounded-lg border border-line bg-surface p-3 transition-colors hover:border-field-line"
      >
        <span className="h-20 w-20 shrink-0 overflow-hidden rounded-md bg-cream">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={record.imageUrl}
            alt=""
            className="h-full w-full object-cover"
          />
        </span>

        <span className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="flex items-start justify-between gap-3">
            <span
              className={cn(
                "truncate text-body font-semibold text-ink",
                "group-hover:underline underline-offset-2",
              )}
            >
              {asserts
                ? record.prediction.breedName
                : notCattle
                  ? t("notcattle.short")
                  : t(`band.${band}.label` as const)}
            </span>
            {asserts ? (
              <span
                data-numeric=""
                className="shrink-0 text-small font-medium text-ink-2"
              >
                {formatConfidence(record.prediction.confidence)}
              </span>
            ) : null}
          </span>

          <span className="flex flex-wrap items-center gap-2">
            {/* The band badge only earns its place when the title is a breed
                name. For uncertain and low records the title already states
                the band, so repeating it here is noise. */}
            {asserts ? (
              <Badge tone={BAND_TONE[band]}>
                {t(`band.${band}.label` as const)}
              </Badge>
            ) : notCattle ? (
              <span className="text-small text-ink-3">{t("hist.noUsable")}</span>
            ) : band === "uncertain" ? (
              <span className="text-small text-ink-3">
                {t("hist.candidates", { n: record.prediction.alternatives.length + 1 })}
              </span>
            ) : (
              // The `low` detail view deliberately shows no candidate list, so
              // the card must not advertise one either.
              <span className="text-small text-ink-3">
                {t("hist.noUsable")}
              </span>
            )}
            {record.location ? (
              <Badge tone="neutral">{t("hist.locSaved")}</Badge>
            ) : null}
            {record.duplicateOf ? (
              <Badge tone="amber">
                {record.duplicateOf.tier === "same" ? t("hist.dupSame") : t("hist.dupSimilar")}
              </Badge>
            ) : null}
          </span>

          <span className="text-micro text-ink-3">
            {new Date(record.createdAt).toLocaleString(dateTag, {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </span>
        </span>
      </Link>
    </li>
  );
}

export function HistoryList() {
  const t = useT();
  const [records, setRecords] = useState<LocalRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [breedFilter, setBreedFilter] = useState("all");
  const [bandFilter, setBandFilter] = useState<BandFilter>("all");

  // Object URLs created by the service must be released, or every visit to
  // this page leaks one blob URL per record for the life of the document.
  const urlsRef = useRef<string[]>([]);

  useEffect(() => {
    let cancelled = false;

    void listRecords().then((result) => {
      if (cancelled) {
        if (result.ok) result.data.forEach((r) => URL.revokeObjectURL(r.imageUrl));
        return;
      }
      if (!result.ok) {
        setError(result.error.message);
        setRecords([]);
        return;
      }
      urlsRef.current = result.data.map((r) => r.imageUrl);
      setRecords(result.data);
    });

    return () => {
      cancelled = true;
      urlsRef.current.forEach((u) => URL.revokeObjectURL(u));
      urlsRef.current = [];
    };
  }, []);

  const breeds = useMemo(() => {
    if (!records) return [];
    return Array.from(
      new Set(records.map((r) => r.prediction.breedName)),
    ).sort();
  }, [records]);

  const results = useMemo(() => {
    if (!records) return [];
    const cutoff = cutoffFor(dateFilter);
    return records.filter((r) => {
      if (cutoff && new Date(r.createdAt).getTime() < cutoff) return false;
      if (breedFilter !== "all" && r.prediction.breedName !== breedFilter)
        return false;
      if (
        bandFilter !== "all" &&
        bandFor(r.prediction.confidence) !== bandFilter
      )
        return false;
      return true;
    });
  }, [records, dateFilter, breedFilter, bandFilter]);

  const filtersActive =
    dateFilter !== "all" || breedFilter !== "all" || bandFilter !== "all";

  // Exports exactly the records currently shown, so a filter is also a way to
  // choose what goes into the file.
  const exportCsv = () => {
    const blob = new Blob([recordsToCsv(results, bandFor)], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `breedvision-records-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const clear = () => {
    setDateFilter("all");
    setBreedFilter("all");
    setBandFilter("all");
  };

  if (records === null) {
    return <LoadingState label={t("hist.loading")} rows={3} />;
  }

  if (error) {
    return <ErrorState title={t("hist.readFail")} description={error} />;
  }

  if (records.length === 0) {
    return (
      <EmptyState
        title={t("hist.empty.title")}
        description={t("hist.empty.desc")}
        action={<ButtonLink href="/identify">{t("nav.identify")}</ButtonLink>}
      />
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t("hist.date")}>
          <Select
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value as DateFilter)}
          >
            <option value="all">{t("hist.anyTime")}</option>
            <option value="today">{t("hist.today")}</option>
            <option value="7d">{t("hist.7d")}</option>
            <option value="30d">{t("hist.30d")}</option>
          </Select>
        </Field>

        <Field label={t("hist.breed")}>
          <Select
            value={breedFilter}
            onChange={(e) => setBreedFilter(e.target.value)}
          >
            <option value="all">{t("hist.allBreeds")}</option>
            {breeds.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={t("hist.confidence")}>
          <Select
            value={bandFilter}
            onChange={(e) => setBandFilter(e.target.value as BandFilter)}
          >
            <option value="all">{t("hist.anyConf")}</option>
            <option value="confident">{t("band.confident.label")}</option>
            <option value="uncertain">{t("band.uncertain.label")}</option>
            <option value="low">{t("band.low.label")}</option>
          </Select>
        </Field>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
        <p className="text-small text-ink-2" role="status" aria-live="polite">
          <span data-numeric="" className="font-medium text-ink">
            {filtersActive
              ? t("count.records.filtered", { n: results.length, total: records.length })
              : t(results.length === 1 ? "count.records.one" : "count.records.many", {
                  n: results.length,
                })}
          </span>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {filtersActive ? (
            <Button variant="quiet" size="sm" onClick={clear}>
              {t("common.clear")}
            </Button>
          ) : null}
          <Button
            variant="secondary"
            size="sm"
            onClick={exportCsv}
            disabled={results.length === 0}
          >
            {t("hist.export")}
          </Button>
        </div>
      </div>

      {results.length === 0 ? (
        <EmptyState
          title={t("hist.noMatch.title")}
          description={t("hist.noMatch.desc")}
          action={
            <Button size="sm" variant="secondary" onClick={clear}>
              {t("common.clear")}
            </Button>
          }
        />
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {results.map((r) => (
            <RecordCard key={r.id} record={r} />
          ))}
        </ul>
      )}
    </div>
  );
}
