import { Fragment, type ReactNode } from "react";
import { siteConfig } from "@/config/site";

type Token = { text: string; tone?: "prompt" | "flag" | "value" | "comment" };
type Line = Token[];

const TONES: Record<NonNullable<Token["tone"]>, string> = {
  prompt: "text-[#8d9bc2] select-none",
  flag: "text-[#9fe8ff]",
  value: "text-[#ffd49a]",
  comment: "text-[#8d9bc2]",
};

function repositoryName(url: string): string {
  return url.replace(/\/+$/, "").split("/").pop() ?? "codeverse";
}

function lines(): Line[] {
  const cloneUrl = `${siteConfig.repositoryUrl.replace(/\/+$/, "")}.git`;
  const directory = repositoryName(siteConfig.repositoryUrl);
  return [
    [{ text: "# Run it locally", tone: "comment" }],
    [{ text: "$ ", tone: "prompt" }, { text: "git clone " }, { text: cloneUrl, tone: "value" }],
    [{ text: "$ ", tone: "prompt" }, { text: `cd ${directory} && pnpm install` }],
    [{ text: "$ ", tone: "prompt" }, { text: "pnpm dev" }, { text: "   # http://localhost:3000", tone: "comment" }],
    [],
    [{ text: "# Or ship the Docker image", tone: "comment" }],
    [{ text: "$ ", tone: "prompt" }, { text: "docker build " }, { text: "-t", tone: "flag" }, { text: ` ${directory} .` }],
    [
      { text: "$ ", tone: "prompt" },
      { text: "docker run " },
      { text: "-p", tone: "flag" },
      { text: " 3000:3000 " },
      { text: "-e", tone: "flag" },
      { text: " GITHUB_TOKEN=" },
      { text: "github_pat_…", tone: "value" },
      { text: ` ${directory}` },
    ],
  ];
}

function renderLine(line: Line): ReactNode {
  if (line.length === 0) return " ";
  return line.map((token, index) => (
    <Fragment key={index}>
      {token.tone ? <span className={TONES[token.tone]}>{token.text}</span> : token.text}
    </Fragment>
  ));
}

/** Terminal-style window with the real self-hosting commands from the README. */
export function CodeWindow() {
  return (
    <figure className="overflow-hidden rounded-2xl bg-[#0f1a3a] shadow-[0_40px_80px_-30px_rgb(0_0_0/0.6)] ring-1 ring-white/[0.12]">
      <div className="flex h-11 items-center gap-3 border-b border-white/[0.08] px-4">
        <span aria-hidden="true" className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-white/[0.16]" />
          <span className="size-2.5 rounded-full bg-white/[0.16]" />
          <span className="size-2.5 rounded-full bg-white/[0.16]" />
        </span>
        <figcaption className="mx-auto pr-[42px] text-[12.5px] font-medium text-[#b7c1d6]">
          Run your own CodeVerse
        </figcaption>
      </div>
      <pre
        tabIndex={0}
        aria-label="Self-hosting commands"
        className="overflow-x-auto px-5 py-5 font-mono text-[13px] leading-[1.85] text-[#e8ecf7] sm:px-6"
      >
        <code>
          {lines().map((line, index) => (
            <span key={index} className="block whitespace-pre">
              {renderLine(line)}
            </span>
          ))}
        </code>
      </pre>
    </figure>
  );
}
