"use client";

import type { ReactNode } from "react";

import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { useT } from "@/i18n";
import { cn } from "@/lib/cn";

interface StateShellProps {
  icon?: ReactNode;
  title: ReactNode;
  /** Always answer two questions: what happened, and what to do next. */
  description: ReactNode;
  action?: ReactNode;
  className?: string;
  tone?: "neutral" | "error";
}

function StateShell({
  icon,
  title,
  description,
  action,
  className,
  tone = "neutral",
}: StateShellProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-lg border px-6 py-12 text-center",
        tone === "error"
          ? "border-clay/25 bg-clay-soft/50"
          : "border-line bg-surface",
        className,
      )}
    >
      {icon ? (
        <span
          aria-hidden="true"
          className={cn(
            "mb-1",
            tone === "error" ? "text-clay" : "text-ink-4",
          )}
        >
          {icon}
        </span>
      ) : null}
      <h3
        className={cn(
          "text-body font-semibold",
          tone === "error" ? "text-clay" : "text-ink",
        )}
      >
        {title}
      </h3>
      <p className="max-w-sm text-small text-ink-2 text-pretty">{description}</p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

interface EmptyStateProps {
  title: ReactNode;
  description: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}

/** Nothing here yet — say what the user can do to change that. */
export function EmptyState(props: EmptyStateProps) {
  return <StateShell {...props} tone="neutral" />;
}

interface ErrorStateProps {
  /** Short, specific. Never "Something went wrong". */
  title?: ReactNode;
  description: ReactNode;
  onRetry?: () => void;
  retryLabel?: ReactNode;
  className?: string;
}

/**
 * Failure state. The description must name the likely cause and the next
 * action, e.g. "Image could not be analysed. Try a clearer photo of the
 * whole animal."
 */
export function ErrorState({
  title,
  description,
  onRetry,
  retryLabel,
  className,
}: ErrorStateProps) {
  const t = useT();
  return (
    <StateShell
      tone="error"
      title={title ?? t("state.errorTitle")}
      description={description}
      className={className}
      action={
        onRetry ? (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            {retryLabel ?? t("state.retry")}
          </Button>
        ) : null
      }
    />
  );
}

interface LoadingStateProps {
  /** Announced to screen readers, e.g. "Loading your identifications". */
  label: string;
  /** Number of placeholder rows. */
  rows?: number;
  className?: string;
}

/** Skeleton list. Mirrors the shape of the content it replaces. */
export function LoadingState({ label, rows = 3, className }: LoadingStateProps) {
  return (
    <div className={cn("flex flex-col gap-3", className)} aria-busy="true">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 rounded-lg border border-line bg-surface p-4"
        >
          <Skeleton className="h-14 w-14 shrink-0 rounded-md" label={label} />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-2/5" label={label} />
            <Skeleton className="h-3 w-1/4" label={label} />
          </div>
        </div>
      ))}
    </div>
  );
}
