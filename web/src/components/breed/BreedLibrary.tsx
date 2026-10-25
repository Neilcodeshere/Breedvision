"use client";

import Link from "next/link";
import { useDeferredValue, useMemo, useState } from "react";

import { BreedImage } from "@/components/breed/BreedImage";
import { EmptyState } from "@/components/states";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { useT } from "@/i18n";
import { cn } from "@/lib/cn";
import type { AnimalCategory, BreedSummary } from "@/types";

type CategoryFilter = "all" | AnimalCategory;

interface BreedLibraryProps {
  breeds: BreedSummary[];
}

function BreedCard({
  breed,
  showBadge,
}: {
  breed: BreedSummary;
  /** Hidden when every breed shares one category — it would say nothing. */
  showBadge: boolean;
}) {
  const t = useT();
  return (
    <li>
      <Link
        href={`/breeds/${breed.id}`}
        className={cn(
          "group flex h-full flex-col overflow-hidden rounded-lg border border-line bg-surface",
          "transition-colors hover:border-field-line",
        )}
      >
        <div className="aspect-4/3 w-full overflow-hidden border-b border-line">
          <BreedImage
            name={breed.name}
            category={breed.category}
            imageUrl={breed.imageUrl}
          />
        </div>
        <div className="flex flex-1 flex-col gap-2 p-4">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-body font-semibold text-ink group-hover:underline underline-offset-2">
              {breed.name}
            </h2>
            {showBadge ? (
              <Badge
                tone={breed.category === "buffalo" ? "terracotta" : "neutral"}
              >
                {breed.category === "buffalo" ? t("cat.buffalo") : t("cat.cattle")}
              </Badge>
            ) : null}
          </div>
          <p className="text-small text-ink-3">
            {breed.region ?? t("breeds.tractMissing")}
          </p>
        </div>
      </Link>
    </li>
  );
}

/** "Maharashtra and Gujarat (registry name: X)" -> ["Gujarat", "Maharashtra"]. */
function statesOf(region: string | null): string[] {
  if (!region) return [];
  return region
    .replace(/\(.*?\)/g, "")
    .split(/,| and /)
    .map((r) => r.trim())
    .filter((r) => r && !/farm/i.test(r));
}

export function BreedLibrary({ breeds }: BreedLibraryProps) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [region, setRegion] = useState("all");

  // Keeps typing responsive if the list grows to the full ~50 breeds.
  const deferredQuery = useDeferredValue(query);

  const regions = useMemo(
    () => Array.from(new Set(breeds.flatMap((b) => statesOf(b.region)))).sort(),
    [breeds],
  );

  // Filters are shown only when the data can actually be filtered: the
  // category control stays hidden while the library is cattle-only. A control
  // that can only ever return everything is noise pretending to be a feature.
  const categories = useMemo(
    () => Array.from(new Set(breeds.map((b) => b.category))),
    [breeds],
  );
  const showCategoryFilter = categories.length > 1;
  const showRegionFilter = regions.length > 0;

  const results = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    return breeds.filter((b) => {
      if (category !== "all" && b.category !== category) return false;
      if (region !== "all" && !statesOf(b.region).includes(region)) return false;
      if (!q) return true;
      return (
        b.name.toLowerCase().includes(q) ||
        (b.region?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [breeds, deferredQuery, category, region]);

  const filtersActive = query !== "" || category !== "all" || region !== "all";

  const clear = () => {
    setQuery("");
    setCategory("all");
    setRegion("all");
  };

  return (
    <div className="flex flex-col gap-8">
      <div
        className={cn(
          "grid gap-4",
          showCategoryFilter || showRegionFilter
            ? "sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr]"
            : "max-w-md",
        )}
      >
        <Field label={t("breeds.search")} hint={t("breeds.search.hint")}>
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("breeds.search.placeholder")}
          />
        </Field>

        {showCategoryFilter ? (
          <Field label={t("breeds.animal")}>
            <Select
              value={category}
              onChange={(e) => setCategory(e.target.value as CategoryFilter)}
            >
              <option value="all">{t("breeds.allAnimals")}</option>
              <option value="cattle">{t("cat.cattle")}</option>
              <option value="buffalo">{t("cat.buffalo")}</option>
            </Select>
          </Field>
        ) : null}

        {showRegionFilter ? (
          <Field label={t("breeds.region")}>
            <Select value={region} onChange={(e) => setRegion(e.target.value)}>
              <option value="all">{t("breeds.allRegions")}</option>
              {regions.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
        <p className="text-small text-ink-2" role="status" aria-live="polite">
          <span data-numeric="" className="font-medium text-ink">
            {filtersActive
              ? t("count.breeds.filtered", { n: results.length, total: breeds.length })
              : t(results.length === 1 ? "count.breeds.one" : "count.breeds.many", {
                  n: results.length,
                })}
          </span>
        </p>
        {filtersActive ? (
          <Button variant="quiet" size="sm" onClick={clear}>
            {t("common.clear")}
          </Button>
        ) : null}
      </div>

      {results.length === 0 ? (
        <EmptyState
          title={t("breeds.empty.title")}
          description={t("breeds.empty.desc")}
          action={
            <Button size="sm" variant="secondary" onClick={clear}>
              {t("common.clear")}
            </Button>
          }
        />
      ) : (
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {results.map((b) => (
            <BreedCard key={b.id} breed={b} showBadge={showCategoryFilter} />
          ))}
        </ul>
      )}
    </div>
  );
}
