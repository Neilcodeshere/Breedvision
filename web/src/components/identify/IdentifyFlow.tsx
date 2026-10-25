"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { DuplicateNotice, RemoteDuplicateNotice } from "@/components/prediction/DuplicateNotice";
import { HeatmapPanel } from "@/components/prediction/HeatmapPanel";
import { PredictionResult } from "@/components/prediction/PredictionResult";
import { ErrorState } from "@/components/states";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { MockDataNotice } from "@/components/ui/MockDataNotice";
import { useDateTag, useT } from "@/i18n";
import { cn } from "@/lib/cn";
import { bandForPrediction } from "@/lib/confidence";
import {
  captureLocation,
  getLocationPreference,
  setLocationPreference,
} from "@/lib/geolocation";
import { formatBytes, prepareImage, type PreparedImage } from "@/lib/image";
import {
  findDuplicate,
  fingerprint,
  type DuplicateMatch,
  type PhotoFingerprint,
} from "@/services/duplicates";
import { currentUser, remoteDuplicate, syncAll, type RemoteDuplicate } from "@/services/cloud";
import { predictBreed } from "@/services/predictions";
import { saveRecord } from "@/services/records";
import { ACCOUNTS_ENABLED, IMAGE_LIMITS } from "@/services/config";
import type { GeoLocation, Prediction, ServiceError } from "@/types";

/**
 * Phases map to real async boundaries — there is no invented progress.
 * `preparing` covers decode + downscale; `analysing` covers the request in
 * flight. We cannot know sub-progress inside the request, so that phase shows
 * an indeterminate indicator rather than a fabricated percentage.
 */
type Phase = "idle" | "preparing" | "ready" | "analysing" | "done" | "failed";

const GUIDANCE = [1, 2, 3, 4] as const;

export function IdentifyFlow() {
  const t = useT();
  const dateTag = useDateTag();
  const [phase, setPhase] = useState<Phase>("idle");
  const [image, setImage] = useState<PreparedImage | null>(null);
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [error, setError] = useState<ServiceError | null>(null);
  const [dragging, setDragging] = useState(false);
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "saved" | "failed"
  >("idle");
  const [savedId, setSavedId] = useState<string | null>(null);
  const [fp, setFp] = useState<PhotoFingerprint | null>(null);
  const [duplicate, setDuplicate] = useState<DuplicateMatch | null>(null);
  const [remoteDup, setRemoteDup] = useState<RemoteDuplicate | null>(null);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const [attachLocation, setAttachLocation] = useState(false);
  const [savedLocation, setSavedLocation] = useState<GeoLocation | null>(null);
  const [locationNote, setLocationNote] = useState<string | null>(null);

  // Read the remembered choice after mount; localStorage does not exist during
  // server rendering, so it cannot seed the initial state.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAttachLocation(getLocationPreference());
  }, []);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    if (image) URL.revokeObjectURL(image.previewUrl);
    setImage(null);
    setPrediction(null);
    setError(null);
    setSaveState("idle");
    setSavedId(null);
    setSavedLocation(null);
    setLocationNote(null);
    setFp(null);
    setDuplicate(null);
    setRemoteDup(null);
    setSyncNote(null);
    setPhase("idle");
  }, [image]);

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      setPhase("preparing");

      const prepared = await prepareImage(file);
      if (!prepared.ok) {
        setError(prepared.error);
        setPhase("failed");
        return;
      }
      setImage(prepared.data);
      setPhase("ready");
    },
    [],
  );

  const analyse = useCallback(async () => {
    if (!image) return;
    setPhase("analysing");
    setError(null);

    const result = await predictBreed(image.file);
    if (!result.ok) {
      setError(result.error);
      setPhase("failed");
      return;
    }
    setPrediction(result.data);
    setPhase("done");

    // Duplicate-photo check. Runs after the result is shown and can never block
    // it: any failure just means no notice.
    try {
      const f = await fingerprint(image.file);
      setFp(f);
      const local = await findDuplicate(f);
      setDuplicate(local);
      // Only ask the cloud when the device found nothing and an account exists.
      setRemoteDup(
        local || !ACCOUNTS_ENABLED ? null : await remoteDuplicate(f),
      );
    } catch {
      setFp(null);
      setDuplicate(null);
      setRemoteDup(null);
    }
  }, [image]);

  const save = useCallback(async () => {
    if (!image || !prediction) return;
    setSaveState("saving");
    setLocationNote(null);

    // Location is optional and never blocks the save.
    let location: GeoLocation | null = null;
    if (attachLocation) {
      const loc = await captureLocation();
      if (loc.ok) location = loc.location;
      else setLocationNote(loc.reason);
    }

    const result = await saveRecord({
      file: image.file,
      prediction,
      width: image.width,
      height: image.height,
      location,
      phash: fp?.hash,
      duplicateOf: duplicate
        ? { id: duplicate.recordId, distance: duplicate.distance, tier: duplicate.tier }
        : null,
    });
    if (!result.ok) {
      setSaveState("failed");
      setError(result.error);
      return;
    }
    setSavedId(result.data.id);
    setSavedLocation(location);
    setSaveState("saved");

    // If signed in, upload straight away. Never blocks or fails the save: the
    // record is already safe on the device and simply stays pending on error.
    if (ACCOUNTS_ENABLED && (await currentUser())) {
      const r = await syncAll();
      setSyncNote(
        r.ok && r.data.recordsFailed.length === 0
          ? t("flow.synced")
          : t("flow.syncFailed"),
      );
    }
  }, [image, prediction, attachLocation, fp, duplicate, t]);

  /* ------------------------------------------------------------- result -- */
  if (phase === "done" && prediction && image) {
    return (
      <div className="flex flex-col gap-8">
        <MockDataNotice what={t("flow.mockWhat")} />
        {duplicate && saveState !== "saved" ? <DuplicateNotice match={duplicate} /> : null}
        {remoteDup && saveState !== "saved" ? <RemoteDuplicateNotice match={remoteDup} /> : null}

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-12">
          <div className="flex flex-col gap-4">
          <figure className="flex flex-col gap-3">
            <div className="relative aspect-4/3 overflow-hidden rounded-lg border border-line bg-cream">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={image.previewUrl}
                alt={t("flow.imgAlt")}
                className="h-full w-full object-cover"
              />
            </div>
            <figcaption className="text-micro text-ink-3">
              {image.width} × {image.height} · {formatBytes(image.bytes)}
            </figcaption>
          </figure>
            <HeatmapPanel file={image.file} />
          </div>

          <div className="flex flex-col gap-8">
            <PredictionResult prediction={prediction} />

            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-t border-line pt-6">
              <div>
                <dt className="text-micro uppercase tracking-[0.14em] text-ink-3">
                  {t("flow.recorded")}
                </dt>
                <dd className="mt-1 text-small text-ink-2">
                  {new Date().toLocaleString(dateTag, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </dd>
              </div>
              <div>
                <dt className="text-micro uppercase tracking-[0.14em] text-ink-3">
                  {t("flow.modelVersion")}
                </dt>
                <dd className="mt-1 text-small text-ink-2">
                  {prediction.modelVersion}
                </dd>
              </div>
              <div>
                <dt className="text-micro uppercase tracking-[0.14em] text-ink-3">
                  {t("flow.location")}
                </dt>
                <dd className="mt-1 text-small text-ink-2">
                  {savedLocation ? (
                    <span data-numeric="">
                      {savedLocation.latitude.toFixed(4)},{" "}
                      {savedLocation.longitude.toFixed(4)}
                      {savedLocation.accuracyM !== null
                        ? ` (±${savedLocation.accuracyM} m)`
                        : ""}
                    </span>
                  ) : (
                    <span className="text-ink-3">{t("flow.notCaptured")}</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-micro uppercase tracking-[0.14em] text-ink-3">
                  {t("flow.analysisTime")}
                </dt>
                <dd data-numeric="" className="mt-1 text-small text-ink-2">
                  {prediction.inferenceMs
                    ? `${(prediction.inferenceMs / 1000).toFixed(2)} s`
                    : "—"}
                </dd>
              </div>
            </dl>

            {saveState !== "saved" ? (
              <label className="flex min-h-11 cursor-pointer items-start gap-3 text-small text-ink-2">
                <input
                  type="checkbox"
                  checked={attachLocation}
                  onChange={(e) => {
                    setAttachLocation(e.target.checked);
                    setLocationPreference(e.target.checked);
                  }}
                  className="mt-0.5 h-5 w-5 shrink-0 accent-forest"
                />
                <span>
                  {t("flow.attachLoc")}
                  <span className="block text-micro text-ink-3">
                    {t("flow.attachLoc.hint")}
                  </span>
                </span>
              </label>
            ) : null}

            <div className="flex flex-wrap gap-3">
              {saveState === "saved" ? (
                <ButtonLink href={`/history/${savedId}`} size="lg">
                  {t("flow.viewSaved")}
                </ButtonLink>
              ) : (
                <Button
                  size="lg"
                  onClick={save}
                  disabled={saveState === "saving"}
                >
                  {saveState === "saving" ? t("flow.saving") : t("flow.save")}
                </Button>
              )}
              <Button size="lg" variant="secondary" onClick={reset}>
                {t("flow.another")}
              </Button>
              <ButtonLink
                href={`/breeds/${prediction.breedId}`}
                size="lg"
                variant="secondary"
              >
                {t("flow.viewBreed")}
              </ButtonLink>
              {/* Only when the app actually named a breed. */}
              {bandForPrediction(prediction) === "confident" &&
              prediction.looksLikeCattle !== false ? (
                <ButtonLink
                  href={`/prices?breed=${prediction.breedId}`}
                  size="lg"
                  variant="secondary"
                >
                  {t("flow.estimateValue")}
                </ButtonLink>
              ) : null}
            </div>

            <p className="text-micro text-ink-3" role="status" aria-live="polite">
              {saveState === "saved"
                ? `${t("flow.savedOnDevice")}${
                    savedLocation ? ` ${t("flow.locAttached")}` : ""
                  }${locationNote ? ` ${locationNote}` : ""}${syncNote ? ` ${syncNote}` : ""}`
                : saveState === "failed"
                  ? (error?.message ?? t("flow.saveFailed"))
                  : t("flow.localOnly")}
            </p>
          </div>
        </div>
      </div>
    );
  }

  /* --------------------------------------------------------- processing -- */
  if (phase === "analysing" || phase === "preparing") {
    return (
      <Card variant="outlined" className="py-16">
        <div className="mx-auto flex max-w-sm flex-col items-center gap-5 text-center">
          <span
            aria-hidden="true"
            className="h-8 w-8 animate-spin rounded-full border-2 border-line border-t-forest"
          />
          <div role="status" aria-live="polite">
            <p className="text-body font-medium text-ink">
              {phase === "preparing" ? t("flow.preparing") : t("flow.analysing")}
            </p>
            <p className="mt-1.5 text-small text-ink-3">
              {phase === "preparing"
                ? t("flow.preparing.body")
                : t("flow.analysing.body")}
            </p>
          </div>
        </div>
      </Card>
    );
  }

  /* ------------------------------------------------------------ preview -- */
  if (phase === "ready" && image) {
    return (
      <div className="flex flex-col gap-6">
        <div className="overflow-hidden rounded-lg border border-line bg-cream">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image.previewUrl}
            alt={t("flow.previewAlt")}
            className="max-h-[26rem] w-full object-contain"
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-small text-ink-3">
            {image.width} × {image.height} · {formatBytes(image.bytes)}
            {image.bytes < image.originalBytes ? (
              <> · {t("flow.reducedFrom", { size: formatBytes(image.originalBytes) })}</>
            ) : null}
          </p>
          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" size="lg" onClick={reset}>
              {t("flow.change")}
            </Button>
            <Button size="lg" onClick={analyse}>
              {t("flow.analyse")}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  /* --------------------------------------------------- idle and failure -- */
  return (
    <div className="flex flex-col gap-6">
      {phase === "failed" && error ? (
        <ErrorState
          title={t("flow.failTitle")}
          description={error.message}
          onRetry={reset}
          retryLabel={t("flow.chooseAnother")}
        />
      ) : null}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer.files?.[0];
          if (f) void handleFile(f);
        }}
        className={cn(
          "rounded-lg border-2 border-dashed px-6 py-14 text-center transition-colors",
          dragging
            ? "border-forest bg-forest-soft"
            : "border-line-strong bg-surface",
        )}
      >
        <svg
          viewBox="0 0 24 24"
          className="mx-auto h-9 w-9 text-ink-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h2.2l1.1-1.8A1.5 1.5 0 0 1 9.1 4.5h5.8a1.5 1.5 0 0 1 1.3.7L17.3 7h2.2A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" />
          <circle cx="12" cy="12.8" r="3.4" />
        </svg>

        <h2 className="mt-4 text-title font-semibold text-ink">
          {t("flow.drop.title")}
        </h2>
        <p className="mx-auto mt-2 max-w-sm text-body text-ink-2 text-pretty">
          {t("flow.drop.body")}
        </p>

        <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button
            size="lg"
            onClick={() => cameraInputRef.current?.click()}
            className="w-full sm:w-auto"
          >
            {t("flow.takePhoto")}
          </Button>
          <Button
            size="lg"
            variant="secondary"
            onClick={() => fileInputRef.current?.click()}
            className="w-full sm:w-auto"
          >
            {t("flow.upload")}
          </Button>
        </div>

        <p className="mt-5 text-micro text-ink-3">
          {t("flow.limits", { mb: IMAGE_LIMITS.maxBytes / (1024 * 1024) })}
        </p>

        <input
          ref={cameraInputRef}
          type="file"
          accept={IMAGE_LIMITS.acceptAttribute}
          capture="environment"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
            e.target.value = "";
          }}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept={IMAGE_LIMITS.acceptAttribute}
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
            e.target.value = "";
          }}
        />
      </div>

      <Card variant="sunk">
        <h2 className="text-small font-semibold text-ink">
          {t("flow.guide.title")}
        </h2>
        <ul className="mt-3 grid gap-2 text-small text-ink-2 sm:grid-cols-2">
          {GUIDANCE.map((g) => (
            <li key={g} className="flex items-start gap-2">
              <span
                aria-hidden="true"
                className="mt-2 h-1 w-1 shrink-0 rounded-full bg-ink-4"
              />
              {t(`flow.guide.${g}` as const)}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
