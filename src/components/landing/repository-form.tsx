"use client";

import { ArrowRight, CircleAlert, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition, type FormEvent } from "react";
import { GitHubMark } from "@/components/brand/github-mark";
import { buttonClasses } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import { REPOSITORY_INPUT_ID } from "./constants";
import { resolveRepositoryTarget } from "./repository-target";

export interface RepositoryFormProps {
  /** DOM id of the input; CTAs elsewhere on the page focus it by id. */
  inputId?: string;
  /** Initial value, e.g. a repository guessed from a mistyped URL. */
  defaultValue?: string;
  className?: string;
}

/**
 * The "paste a repository" form. Validates locally with the shared parser (the
 * server validates again), reports problems inline, and navigates to the
 * explorer on success.
 */
export function RepositoryForm({
  inputId = REPOSITORY_INPUT_ID,
  defaultValue = "",
  className,
}: RepositoryFormProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(defaultValue);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const hintId = useId();
  const errorId = useId();

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const target = resolveRepositoryTarget(value);
    if (!target.ok) {
      setError(target.message);
      inputRef.current?.focus();
      return;
    }
    setError(null);
    startTransition(() => router.push(target.href));
  };

  return (
    <form noValidate onSubmit={handleSubmit} className={className}>
      <label
        htmlFor={inputId}
        className="text-ink-muted font-mono text-[11px] tracking-[0.18em] uppercase"
      >
        GitHub repository
      </label>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <div
          className={cn(
            "bg-void/80 flex min-w-0 flex-1 items-center rounded-xl border transition-[border-color,box-shadow] duration-150",
            error
              ? "border-danger/70 focus-within:shadow-[0_0_0_3px_rgba(255,107,122,0.2)]"
              : "border-line-strong focus-within:border-signal/70 focus-within:shadow-[0_0_0_3px_rgba(77,226,255,0.16)]",
          )}
        >
          <GitHubMark className="text-ink-muted ml-3.5 size-4 shrink-0" />
          <input
            ref={inputRef}
            id={inputId}
            name="repository"
            type="text"
            inputMode="url"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            placeholder="https://github.com/facebook/react"
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              if (error) setError(null);
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${errorId} ${hintId}` : hintId}
            className="text-ink placeholder:text-ink-muted/75 h-12 w-full min-w-0 bg-transparent px-3 font-mono text-base focus-visible:outline-none sm:text-[13px]"
          />
        </div>
        <button
          type="submit"
          disabled={isPending}
          className={buttonClasses("primary", "lg", "h-12 shrink-0 px-5")}
        >
          {isPending ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : null}
          Explore
          <ArrowRight aria-hidden="true" className="size-4" />
        </button>
      </div>
      {error ? (
        <p
          id={errorId}
          role="alert"
          className="text-danger mt-2.5 flex items-start gap-1.5 text-sm"
        >
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      ) : null}
      <p id={hintId} className="text-ink-muted mt-2.5 text-xs leading-relaxed">
        Any public repository. Paste a URL or <span className="font-mono">owner/name</span>; branch
        and tag links open that revision.
      </p>
    </form>
  );
}
