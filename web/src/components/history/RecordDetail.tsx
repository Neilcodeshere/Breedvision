"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { PredictionResult } from "@/components/prediction/PredictionResult";
import { ErrorState, LoadingState } from "@/components/states";
import { Button, ButtonLink } from "@/components/ui/Button";
import { useDateTag, useT, type MessageKey } from "@/i18n";
import { deleteRecord, getRecord, type LocalRecord } from "@/services/records";

const SYNC_LABEL: Record<LocalRecord["syncState"], MessageKey> = {
  "local-only": "rec.sync.local",
  pending: "rec.sync.pending",
  synced: "rec.sync.synced",
};

export function RecordDetail({ id }: { id: string }) {
  const t = useT();
  const dateTag = useDateTag();
  const router = useRouter();
  const [record, setRecord] = useState<LocalRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void getRecord(id).then((result) => {
      if (cancelled) {
        if (result.ok) URL.revokeObjectURL(result.data.imageUrl);
        return;
      }
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      urlRef.current = result.data.imageUrl;
      setRecord(result.data);
    });

    return () => {
      cancelled = true;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    };
  }, [id]);

  if (error) {
    return (
      <ErrorState
        title={t("rec.notFound")}
        description={error}
        onRetry={() => router.push("/history")}
        retryLabel={t("rec.back")}
      />
    );
  }

  if (!record) {
    return <LoadingState label={t("rec.loading")} rows={1} />;
  }

  const onDelete = async () => {
    setDeleting(true);
    const result = await deleteRecord(record.id);
    if (!result.ok) {
      setError(result.error.message);
      setDeleting(false);
      return;
    }
    router.push("/history");
  };

  return (
    <div className="flex flex-col gap-8">
      <nav aria-label={t("rec.crumbAria")} className="text-small">
        <Link
          href="/history"
          className="text-ink-3 underline-offset-2 hover:text-ink hover:underline"
        >
          {t("nav.history")}
        </Link>
        <span aria-hidden="true" className="mx-2 text-ink-4">
          /
        </span>
        <span className="text-ink-2">{t("rec.crumb")}</span>
      </nav>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-12">
        <figure className="flex flex-col gap-3">
          <div className="aspect-4/3 overflow-hidden rounded-lg border border-line bg-cream">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={record.imageUrl}
              alt={t("rec.imgAlt")}
              className="h-full w-full object-cover"
            />
          </div>
          <figcaption className="text-micro text-ink-3">
            {record.imageWidth} × {record.imageHeight}
          </figcaption>
        </figure>

        <div className="flex flex-col gap-8">
          {/* This result is the subject of the page, so it owns the h1. */}
          <PredictionResult prediction={record.prediction} headingLevel="h1" />

          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-t border-line pt-6">
            <div>
              <dt className="text-micro uppercase tracking-[0.14em] text-ink-3">
                {t("flow.recorded")}
              </dt>
              <dd className="mt-1 text-small text-ink-2">
                {new Date(record.createdAt).toLocaleString(dateTag, {
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
                {record.prediction.modelVersion}
              </dd>
            </div>
            <div>
              <dt className="text-micro uppercase tracking-[0.14em] text-ink-3">
                {t("flow.location")}
              </dt>
              <dd className="mt-1 text-small text-ink-2">
                {record.location ? (
                  <span data-numeric="">
                    {record.location.latitude.toFixed(4)},{" "}
                    {record.location.longitude.toFixed(4)}
                  </span>
                ) : (
                  <span className="text-ink-3">{t("flow.notCaptured")}</span>
                )}
              </dd>
            </div>
            {record.duplicateOf ? (
              <div className="col-span-2">
                <dt className="text-micro uppercase tracking-[0.14em] text-ink-3">
                  {t("rec.dup.title")}
                </dt>
                <dd className="mt-1 text-small text-ink-2">
                  <Link
                    href={`/history/${record.duplicateOf.id}`}
                    className="font-medium text-forest underline underline-offset-2"
                  >
                    {record.duplicateOf.tier === "same"
                      ? t("rec.dup.same")
                      : t("rec.dup.similar")}
                  </Link>{" "}
                  {t("rec.dup.note")}
                </dd>
              </div>
            ) : null}
            <div>
              <dt className="text-micro uppercase tracking-[0.14em] text-ink-3">
                {t("rec.storage")}
              </dt>
              <dd className="mt-1 text-small text-ink-2">
                {t(SYNC_LABEL[record.syncState])}
              </dd>
            </div>
          </dl>

          <div className="flex flex-wrap gap-3">
            <ButtonLink href="/identify" size="lg">
              {t("flow.another")}
            </ButtonLink>
            <ButtonLink
              href={`/breeds/${record.prediction.breedId}`}
              size="lg"
              variant="secondary"
            >
              {t("flow.viewBreed")}
            </ButtonLink>
          </div>

          <div className="border-t border-line pt-6">
            {confirming ? (
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-small text-ink-2">
                  {t("rec.delete.confirm")}
                </p>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={onDelete}
                  disabled={deleting}
                >
                  {deleting ? t("rec.deleting") : t("rec.delete.yes")}
                </Button>
                <Button
                  variant="quiet"
                  size="sm"
                  onClick={() => setConfirming(false)}
                >
                  {t("rec.keep")}
                </Button>
              </div>
            ) : (
              <Button
                variant="danger"
                size="sm"
                onClick={() => setConfirming(true)}
              >
                {t("rec.delete")}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
