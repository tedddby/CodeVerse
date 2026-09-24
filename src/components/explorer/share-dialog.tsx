"use client";

import { Check, Copy, Share2 } from "lucide-react";
import { useId, useMemo, useRef, useState, type RefObject } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import {
  captureShareState,
  socialImagePath,
  type ShareCaptureOptions,
} from "@/lib/share/explorer-share-state";
import { buildShareUrl } from "@/lib/share/url-state";
import { useExplorerStore } from "@/state/explorer-store";
import { copyText } from "./clipboard";
import { describeSelection } from "./node-descriptions";

export interface ShareDialogProps {
  /** Ref the explorer was opened with (?ref=), preserved in links. */
  requestedRef?: string;
}

interface OptionRowProps {
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint: string;
}

function OptionRow({ checked, disabled, onChange, label, hint }: OptionRowProps) {
  const id = useId();
  return (
    <div className="flex items-start gap-3 py-1.5">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        aria-describedby={`${id}-hint`}
        className="mt-0.5 size-4 shrink-0 accent-[#4de2ff] disabled:opacity-40"
      />
      <label htmlFor={id} className={disabled ? "text-ink-subtle" : "text-ink"}>
        <span className="block text-sm">{label}</span>
        <span id={`${id}-hint`} className="text-ink-subtle block text-xs">
          {hint}
        </span>
      </label>
    </div>
  );
}

/** Link preview (the generated social image); hides itself if it cannot load. */
function SocialPreview({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <figure className="mb-4">
      {/* Same-origin generated image; next/image optimization adds nothing here. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        width={1200}
        height={630}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className="border-line-strong bg-abyss aspect-[1200/630] w-full rounded-lg border object-cover"
      />
      <figcaption className="text-ink-subtle mt-1.5 text-[11px]">
        Link preview on social networks and chats
      </figcaption>
    </figure>
  );
}

function ShareDialogContent({
  requestedRef,
  onClose,
  copyButtonRef,
}: {
  requestedRef?: string;
  onClose: () => void;
  copyButtonRef: RefObject<HTMLButtonElement | null>;
}) {
  // Snapshot the view once when the dialog opens; the camera keeps moving behind the modal otherwise.
  const [snapshot] = useState(() => {
    const state = useExplorerStore.getState();
    return {
      state,
      origin: typeof window === "undefined" ? "" : window.location.origin,
      canNativeShare: typeof navigator !== "undefined" && typeof navigator.share === "function",
    };
  });
  const { state, origin, canNativeShare } = snapshot;
  const repository = state.graph?.repository;
  const hasSelection = state.selection !== null;
  const hasCamera = state.cameraPose !== null;
  const [options, setOptions] = useState<ShareCaptureOptions>({
    includeCamera: hasCamera,
    includeSelection: hasSelection,
    pinCommit: false,
    requestedRef,
  });
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  const inputRef = useRef<HTMLInputElement>(null);

  const url = useMemo(() => {
    if (!repository) return "";
    return buildShareUrl(
      origin,
      repository.owner,
      repository.name,
      captureShareState(state, options),
    );
  }, [origin, repository, state, options]);

  if (!repository) return null;
  const selectionLabel = describeSelection(state.selection, state.index).replace(/^Selected /, "");

  const onCopy = async () => {
    const ok = await copyText(url);
    setCopied(ok ? "copied" : "failed");
    if (!ok) inputRef.current?.select();
    window.setTimeout(() => setCopied("idle"), 2_000);
  };

  const onNativeShare = async () => {
    try {
      await navigator.share({ title: `${repository.fullName} in 3D`, url });
    } catch {
      // Dismissed by the user or unsupported target: nothing to do.
    }
  };

  const update = (patch: Partial<ShareCaptureOptions>) => {
    setOptions((current) => ({ ...current, ...patch }));
    setCopied("idle");
  };

  return (
    <div className="px-5 pt-4 pb-5">
      <SocialPreview
        src={socialImagePath(repository.owner, repository.name)}
        alt={`Social preview card for ${repository.fullName}`}
      />

      <label
        htmlFor="share-url"
        className="text-ink-subtle mb-1.5 block font-mono text-[10.5px] tracking-[0.18em] uppercase"
      >
        Link
      </label>
      <div className="flex gap-2">
        <input
          id="share-url"
          ref={inputRef}
          readOnly
          value={url}
          onFocus={(event) => event.currentTarget.select()}
          className="border-line-strong bg-abyss text-ink focus-visible:border-signal focus-visible:ring-signal/40 h-10 min-w-0 flex-1 rounded-lg border px-3 font-mono text-xs focus:outline-none focus-visible:ring-2"
        />
        <Button
          ref={copyButtonRef}
          variant="primary"
          onClick={() => void onCopy()}
          className="shrink-0"
        >
          {copied === "copied" ? (
            <Check aria-hidden="true" className="size-4" />
          ) : (
            <Copy aria-hidden="true" className="size-4" />
          )}
          {copied === "copied" ? "Copied" : "Copy link"}
        </Button>
      </div>
      <p aria-live="polite" className="mt-1.5 min-h-4 text-xs">
        {copied === "copied" ? (
          <span className="text-ok">Link copied to the clipboard.</span>
        ) : null}
        {copied === "failed" ? (
          <span className="text-warn">
            Copy was blocked by the browser. The link is selected so you can copy it manually.
          </span>
        ) : null}
      </p>

      <fieldset className="border-line/80 mt-2 border-t pt-3">
        <legend className="sr-only">Include in the link</legend>
        <OptionRow
          checked={options.includeCamera && hasCamera}
          disabled={!hasCamera}
          onChange={(checked) => update({ includeCamera: checked })}
          label="Camera position"
          hint={
            hasCamera
              ? "Opens at your current viewpoint instead of the intro flight."
              : "Move the camera to capture a viewpoint."
          }
        />
        <OptionRow
          checked={options.includeSelection && hasSelection}
          disabled={!hasSelection}
          onChange={(checked) => update({ includeSelection: checked })}
          label="Selection"
          hint={hasSelection ? selectionLabel : "Nothing is selected."}
        />
        <OptionRow
          checked={options.pinCommit}
          onChange={(checked) => update({ pinCommit: checked })}
          label="Pin to this commit"
          hint={`Always shows @${repository.commitSha.slice(0, 7)}, even after new pushes.`}
        />
      </fieldset>

      <div className="mt-4 flex justify-end gap-2">
        {canNativeShare ? (
          <Button variant="secondary" onClick={() => void onNativeShare()}>
            <Share2 aria-hidden="true" className="size-4" />
            Share…
          </Button>
        ) : null}
        <Button variant="ghost" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  );
}

/** Share dialog (panels.share): builds a link that restores the current view. */
export function ShareDialog({ requestedRef }: ShareDialogProps) {
  const open = useExplorerStore((state) => state.panels.share);
  const setPanel = useExplorerStore((state) => state.setPanel);
  const fullName = useExplorerStore(
    (state) => state.graph?.repository.fullName ?? "this repository",
  );
  const copyButtonRef = useRef<HTMLButtonElement>(null);
  const close = () => setPanel("share", false);
  return (
    <Dialog
      open={open}
      onClose={close}
      initialFocusRef={copyButtonRef}
      title="Share this view"
      description={`Anyone with the link opens ${fullName} the way you see it now.`}
    >
      {open ? (
        <ShareDialogContent
          requestedRef={requestedRef}
          onClose={close}
          copyButtonRef={copyButtonRef}
        />
      ) : null}
    </Dialog>
  );
}
