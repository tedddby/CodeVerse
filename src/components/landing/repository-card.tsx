"use client";

import { CircleAlert, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition, type FormEvent } from "react";
import { GitHubMark } from "@/components/brand/github-mark";
import { REPOSITORY_INPUT_ID } from "@/components/landing/constants";
import { resolveRepositoryTarget } from "@/components/landing/repository-target";
import { cn } from "@/lib/utils/cn";
import { HoverArrow } from "./hover-arrow";
import styles from "./landing.module.css";

/**
 * The hero's focal card: paste a repository, get a universe. Validates with the
 * shared parser (the server validates again), reports problems inline, and
 * navigates to the explorer on success.
 */
export function RepositoryCard({ className }: { className?: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
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
    <form
      noValidate
      onSubmit={handleSubmit}
      className={cn(
        "rounded-[20px] bg-white p-1.5 ring-1 ring-[rgb(15_28_63/0.06)] sm:p-2",
        "shadow-[0_1px_1px_rgb(15_28_63/0.04),0_14px_28px_-10px_rgb(15_28_63/0.18),0_48px_96px_-28px_rgb(36_18_130/0.5)]",
        className,
      )}
    >
      <div className="flex items-baseline justify-between gap-4 px-3.5 pt-3 pb-2.5">
        <label htmlFor={REPOSITORY_INPUT_ID} className="text-[14px] font-semibold text-(--lc-ink)">
          GitHub repository
        </label>
        <span className="hidden text-[13px] text-(--lc-muted) sm:inline">
          Public repositories · no account
        </span>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <div
          className={cn(
            "flex h-14 min-w-0 items-center rounded-[14px] bg-(--lc-mist) ring-1 transition-[box-shadow,background-color] duration-150 ring-inset sm:flex-1",
            error
              ? "bg-[#fff6f7] ring-2 ring-[#c8243d]"
              : "ring-(--lc-line) focus-within:bg-white focus-within:shadow-[0_0_0_4px_rgb(91_71_235/0.16)] focus-within:ring-2 focus-within:ring-(--lc-accent)",
          )}
        >
          <GitHubMark className="ml-4 hidden size-[18px] shrink-0 text-(--lc-ink) sm:block" />
          <input
            ref={inputRef}
            id={REPOSITORY_INPUT_ID}
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
            className={cn(
              styles.bareInput,
              "h-full w-full min-w-0 bg-transparent px-3 font-mono text-base text-(--lc-ink) placeholder:text-[#687390] sm:text-[15px]",
            )}
          />
        </div>
        <button
          type="submit"
          disabled={isPending}
          className="group inline-flex h-14 shrink-0 items-center justify-center gap-2 rounded-[14px] bg-(--lc-accent) px-7 text-base font-semibold text-white shadow-[0_1px_2px_rgb(15_28_63/0.2),0_8px_20px_-8px_rgb(91_71_235/0.8)] transition-[background-color] duration-150 hover:bg-(--lc-accent-strong) disabled:opacity-70"
        >
          {isPending ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : null}
          Explore
          <HoverArrow solid className="size-3 transition-transform group-hover:translate-x-0.5" />
        </button>
      </div>
      {error ? (
        <p
          id={errorId}
          role="alert"
          className="flex items-start gap-1.5 px-3.5 pt-3 text-[14px] font-medium text-[#b42036]"
        >
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      ) : null}
      <p id={hintId} className="px-3.5 pt-2.5 pb-2 text-[13px] leading-relaxed text-(--lc-muted)">
        Paste a URL or <span className="font-mono text-(--lc-body)">owner/name</span>. Branch, tag
        and commit links open that revision.
      </p>
    </form>
  );
}
