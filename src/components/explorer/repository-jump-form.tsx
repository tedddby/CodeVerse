"use client";

import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import {
  PARSE_ERROR_MESSAGES,
  explorePath,
  parseRepositoryInput,
} from "@/lib/validation/repository-url";

export interface RepositoryJumpFormProps {
  /** Visible label above the field. */
  label?: string;
  defaultValue?: string;
  autoFocus?: boolean;
  className?: string;
}

/** Explorer path for parsed input, carrying a branch/tag from pasted tree/blob URLs. */
export function explorerHrefForInput(input: string): { href: string } | { error: string } {
  const parsed = parseRepositoryInput(input);
  if (!parsed.ok) return { error: PARSE_ERROR_MESSAGES[parsed.reason] };
  const path = explorePath(parsed.owner, parsed.repo);
  return {
    href: parsed.ref ? `${path}?${new URLSearchParams({ ref: parsed.ref }).toString()}` : path,
  };
}

/** "Try another repository" input: validates locally, then navigates to the explorer. */
export function RepositoryJumpForm({
  label = "Try another repository",
  defaultValue = "",
  autoFocus,
  className,
}: RepositoryJumpFormProps) {
  const router = useRouter();
  const inputId = useId();
  const errorId = useId();
  const [value, setValue] = useState(defaultValue);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = explorerHrefForInput(value);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setError(null);
    router.push(result.href);
  };

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className={cn("w-full", className)}
      role="search"
      aria-label={label}
    >
      <label
        htmlFor={inputId}
        className="text-ink-subtle mb-2 block font-mono text-[10.5px] tracking-[0.18em] uppercase"
      >
        {label}
      </label>
      <div className="flex gap-2">
        <input
          id={inputId}
          type="text"
          inputMode="url"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          autoFocus={autoFocus}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            if (error) setError(null);
          }}
          placeholder="github.com/owner/repository"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className={cn(
            "bg-abyss text-ink placeholder:text-ink-subtle focus-visible:border-signal focus-visible:ring-signal/40 h-10 min-w-0 flex-1 rounded-lg border px-3 font-mono text-sm focus:outline-none focus-visible:ring-2",
            error ? "border-danger/60" : "border-line-strong",
          )}
        />
        <Button type="submit" variant="primary" aria-label="Explore repository">
          <span className="max-sm:hidden">Explore</span>
          <ArrowRight aria-hidden="true" className="size-4" />
        </Button>
      </div>
      {error ? (
        <p id={errorId} role="alert" className="text-danger mt-2 text-xs">
          {error}
        </p>
      ) : null}
    </form>
  );
}
