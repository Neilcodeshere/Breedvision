"use client";

import { createContext, useContext, useId } from "react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * Field wiring.
 *
 * The label/hint/error relationship is passed down through context rather than
 * a render prop, so a Server Component can compose `<Field><Input /></Field>`
 * without handing a function across the server/client boundary.
 */
interface FieldContextValue {
  id: string;
  describedBy: string | undefined;
  invalid: boolean;
}

const FieldContext = createContext<FieldContextValue | null>(null);

/** Props a control should spread to join its Field. Safe outside a Field. */
function useFieldControl(explicitInvalid?: boolean) {
  const ctx = useContext(FieldContext);
  return {
    id: ctx?.id,
    "aria-describedby": ctx?.describedBy,
    "aria-invalid": (explicitInvalid ?? ctx?.invalid) ? true : undefined,
    invalid: explicitInvalid ?? ctx?.invalid ?? false,
  };
}

const CONTROL_BASE = cn(
  "w-full rounded-md border bg-surface text-body text-ink",
  "placeholder:text-ink-4",
  "transition-colors duration-150",
  "disabled:cursor-not-allowed disabled:bg-paper-sunk disabled:text-ink-4",
);

function controlTone(invalid: boolean) {
  return invalid
    ? "border-clay/60 hover:border-clay"
    : "border-field-line hover:border-ink-2";
}

interface FieldProps {
  label: string;
  /** Guidance shown before the user makes a mistake. */
  hint?: ReactNode;
  /** Error sentence: what went wrong and what to do about it. */
  error?: string;
  /** Hides the label visually but keeps it for screen readers. */
  labelHidden?: boolean;
  children: ReactNode;
  className?: string;
}

export function Field({
  label,
  hint,
  error,
  labelHidden,
  children,
  className,
}: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;

  return (
    <FieldContext.Provider
      value={{ id, describedBy, invalid: Boolean(error) }}
    >
      <div className={cn("flex flex-col gap-1.5", className)}>
        <label
          htmlFor={id}
          className={cn(
            "text-small font-medium text-ink-2",
            labelHidden && "sr-only",
          )}
        >
          {label}
        </label>

        {children}

        {error ? (
          <p id={errorId} className="text-small text-clay">
            {error}
          </p>
        ) : hint ? (
          <p id={hintId} className="text-small text-ink-3">
            {hint}
          </p>
        ) : null}
      </div>
    </FieldContext.Provider>
  );
}

type InputProps = ComponentPropsWithoutRef<"input"> & { invalid?: boolean };

export function Input({ className, invalid, ...rest }: InputProps) {
  const field = useFieldControl(invalid);
  return (
    <input
      id={field.id}
      aria-describedby={field["aria-describedby"]}
      aria-invalid={field["aria-invalid"]}
      className={cn(
        CONTROL_BASE,
        controlTone(field.invalid),
        "h-11 px-3",
        className,
      )}
      {...rest}
    />
  );
}

type TextareaProps = ComponentPropsWithoutRef<"textarea"> & {
  invalid?: boolean;
};

export function Textarea({ className, invalid, ...rest }: TextareaProps) {
  const field = useFieldControl(invalid);
  return (
    <textarea
      id={field.id}
      aria-describedby={field["aria-describedby"]}
      aria-invalid={field["aria-invalid"]}
      className={cn(
        CONTROL_BASE,
        controlTone(field.invalid),
        "min-h-24 resize-y px-3 py-2.5",
        className,
      )}
      {...rest}
    />
  );
}

type SelectProps = ComponentPropsWithoutRef<"select"> & { invalid?: boolean };

export function Select({ className, invalid, children, ...rest }: SelectProps) {
  const field = useFieldControl(invalid);
  return (
    <select
      id={field.id}
      aria-describedby={field["aria-describedby"]}
      aria-invalid={field["aria-invalid"]}
      className={cn(
        CONTROL_BASE,
        controlTone(field.invalid),
        "h-11 cursor-pointer appearance-none px-3 pr-9",
        // Chevron as a background image so the control needs no wrapper element.
        "bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2016%2016%22%20fill%3D%22none%22%20stroke%3D%22%236b665c%22%20stroke-width%3D%221.6%22%20stroke-linecap%3D%22round%22%3E%3Cpath%20d%3D%22M4%206.5%208%2010.5%2012%206.5%22%2F%3E%3C%2Fsvg%3E')]",
        "bg-[length:16px_16px] bg-[right_0.75rem_center] bg-no-repeat",
        className,
      )}
      {...rest}
    >
      {children}
    </select>
  );
}
