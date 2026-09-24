import { isValidElement, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SocialCard } from "@/components/brand/social-card";
import { resetRateLimiters, SUMMARY_REQUESTS_PER_MINUTE } from "@/lib/rate-limit/limiters";
import { genericRepositoryDescription } from "@/lib/share/metadata";
import { RepositoryOgCard } from "@/lib/share/og-card";
import { takeSummaryLookup } from "@/lib/share/summary-lookup";
import OpenGraphImage from "./opengraph-image";
import { generateMetadata } from "./page";

/**
 * Page metadata and the social card look repositories up on GitHub only
 * within the client's summary budget; over it, both fall back to generic
 * copy instead of failing.
 */

const mocks = vi.hoisted(() => ({
  headers: vi.fn<() => Promise<Headers>>(),
  fetchRepositorySummary: vi.fn(),
  peekCachedGraph: vi.fn(),
  images: [] as unknown[],
}));

vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("@/sources/github", () => ({ fetchRepositorySummary: mocks.fetchRepositorySummary }));
vi.mock("@/analysis/service", () => ({ peekCachedGraph: mocks.peekCachedGraph }));
vi.mock("@/components/brand/social-card-fonts", () => ({
  loadSocialCardFonts: () => Promise.resolve([]),
}));
vi.mock("@/components/explorer/explorer-app", () => ({ ExplorerApp: () => null }));
vi.mock("next/og", () => ({
  ImageResponse: class {
    constructor(element: unknown) {
      mocks.images.push(element);
    }
    arrayBuffer(): Promise<ArrayBuffer> {
      return Promise.resolve(new ArrayBuffer(8));
    }
  },
}));

const CLIENT = "203.0.113.7";
const SUMMARY = {
  fullName: "acme/widgets",
  description: "Widgets for everyone",
  stars: 1_200,
  forks: 3,
  language: "TypeScript",
};

function clientHeaders(address = CLIENT): Headers {
  return new Headers({ "x-forwarded-for": address });
}

/** Spends the client's whole summary budget. */
function exhaustBudget(address = CLIENT): void {
  while (takeSummaryLookup(clientHeaders(address), "metadata")) {
    // Keep taking tokens until the limiter refuses.
  }
}

function pageProps(owner: string, repo: string) {
  return { params: Promise.resolve({ owner, repo }), searchParams: Promise.resolve({}) };
}

function renderedElement(): ReactElement {
  const element = mocks.images.at(-1);
  if (!isValidElement(element)) throw new Error("no image was rendered");
  return element;
}

beforeEach(() => {
  vi.stubEnv("CODEVERSE_TRUSTED_PROXY_HOPS", "");
  vi.stubEnv("CODEVERSE_CLIENT_IP_HEADER", "");
  resetRateLimiters();
  mocks.headers.mockReset().mockImplementation(() => Promise.resolve(clientHeaders()));
  mocks.fetchRepositorySummary.mockReset().mockResolvedValue(SUMMARY);
  mocks.peekCachedGraph.mockReset().mockResolvedValue(null);
  mocks.images.length = 0;
});

afterEach(() => {
  resetRateLimiters();
  vi.unstubAllEnvs();
});

describe("generateMetadata", () => {
  it("describes the repository from GitHub within the client's budget", async () => {
    const metadata = await generateMetadata(pageProps("acme", "widgets"));
    expect(metadata.title).toBe("Explore acme/widgets in 3D");
    expect(metadata.description).toBe("Widgets for everyone · 1.2K stars · TypeScript");
    expect(mocks.fetchRepositorySummary).toHaveBeenCalledWith(
      "acme",
      "widgets",
      expect.any(AbortSignal),
    );
  });

  it("falls back to the generic description without calling GitHub once the budget is spent", async () => {
    exhaustBudget();
    const metadata = await generateMetadata(pageProps("acme", "widgets"));
    expect(metadata.title).toBe("Explore acme/widgets in 3D");
    expect(metadata.description).toBe(genericRepositoryDescription("acme/widgets"));
    expect(metadata.openGraph?.description).toBe(genericRepositoryDescription("acme/widgets"));
    expect(mocks.fetchRepositorySummary).not.toHaveBeenCalled();

    // Other clients keep their own budget.
    mocks.headers.mockResolvedValue(clientHeaders("198.51.100.4"));
    expect((await generateMetadata(pageProps("acme", "widgets"))).description).toBe(
      "Widgets for everyone · 1.2K stars · TypeScript",
    );
  });

  it("spends no budget on invalid repository names", async () => {
    const metadata = await generateMetadata(pageProps("-bad", "widgets"));
    expect(metadata.title).toBe("Repository not found");
    expect(mocks.headers).not.toHaveBeenCalled();
    let allowed = 0;
    while (takeSummaryLookup(clientHeaders(), "metadata")) allowed += 1;
    expect(allowed).toBe(SUMMARY_REQUESTS_PER_MINUTE / 2);
  });
});

describe("OpenGraphImage", () => {
  const imageProps = (owner: string, repo: string) => ({
    params: Promise.resolve({ owner, repo }),
  });

  it("renders the repository card within the client's budget", async () => {
    const response = await OpenGraphImage(imageProps("acme", "widgets"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("max-age=3600");
    expect(renderedElement().type).toBe(RepositoryOgCard);
    expect(mocks.fetchRepositorySummary).toHaveBeenCalledTimes(1);
  });

  it("serves the branded card, briefly cached, without any lookup once the budget is spent", async () => {
    exhaustBudget();
    const response = await OpenGraphImage(imageProps("acme", "widgets"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("max-age=300");
    const card = renderedElement();
    expect(card.type).toBe(SocialCard);
    expect(card.props).toMatchObject({ title: "acme/widgets" });
    expect(mocks.fetchRepositorySummary).not.toHaveBeenCalled();
    expect(mocks.peekCachedGraph).not.toHaveBeenCalled();
  });
});
