"use client";

import { useState } from "react";
import type { ContributorNode } from "@/graph/model/types";
import { cn } from "@/lib/utils/cn";
import { initials, isSafeAvatarUrl } from "./contributors-model";

export interface ContributorAvatarProps {
  contributor: Pick<ContributorNode, "name" | "avatarUrl">;
  size?: number;
  className?: string;
}

/**
 * Avatar from GitHub's avatar CDN only (plain <img>, no referrer); anything
 * else — or a failed load — falls back to initials.
 */
export function ContributorAvatar({ contributor, size = 28, className }: ContributorAvatarProps) {
  const [failed, setFailed] = useState(false);
  const url = contributor.avatarUrl;
  const style = { width: size, height: size };
  if (isSafeAvatarUrl(url) && !failed) {
    const sized = `${url}${url.includes("?") ? "&" : "?"}s=${size * 2}`;
    return (
      // Plain <img> on purpose: avatars come straight from GitHub's CDN and must not
      // be proxied through the image optimizer.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={sized}
        alt={contributor.name}
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className={cn(
          "border-line-strong bg-panel-raised shrink-0 rounded-full border object-cover",
          className,
        )}
        style={style}
      />
    );
  }
  return (
    <span
      role="img"
      aria-label={contributor.name}
      className={cn(
        "border-line-strong bg-panel-raised text-ink-muted flex shrink-0 items-center justify-center rounded-full border font-mono select-none",
        className,
      )}
      style={{ ...style, fontSize: Math.max(9, Math.round(size * 0.36)) }}
    >
      {initials(contributor.name)}
    </span>
  );
}
