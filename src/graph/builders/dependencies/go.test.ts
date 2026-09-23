import { describe, expect, it } from "vitest";
import { parseGoMod } from "./go";
import { resolveMiniRepository } from "./test-support";

describe("parseGoMod", () => {
  it("reads module, require blocks and local replacements, ignoring comments", () => {
    const parsed = parseGoMod(`// Tooling module
module github.com/acme/tool // the main module

go 1.22

require (
  github.com/spf13/cobra v1.8.0
  golang.org/x/net v0.20.0 // indirect
)
require go.uber.org/zap v1.27.0

replace github.com/acme/shared => ../shared
replace github.com/other/lib v1.0.0 => github.com/fork/lib v1.0.1
`);
    expect(parsed.module).toBe("github.com/acme/tool");
    expect(parsed.requires).toEqual([
      "github.com/spf13/cobra",
      "golang.org/x/net",
      "go.uber.org/zap",
    ]);
    expect(parsed.replaces).toEqual([{ path: "github.com/acme/shared", directory: "../shared" }]);
  });
});

describe("Go resolution", () => {
  const main = "cmd/tool/main.go";
  const repo = resolveMiniRepository({
    configs: {
      "go.mod": `module github.com/acme/tool\n\nrequire (\n\tgithub.com/spf13/cobra v1.8.0\n\tgo.uber.org/zap v1.27.0\n)\n`,
      "tools/go.mod": "module github.com/acme/tool/tools\n",
    },
    sources: {
      [main]: [
        "github.com/acme/tool/internal/server",
        "github.com/acme/tool/tools/gen",
        "github.com/acme/tool/internal/missing",
        "fmt",
        "net/http",
        "github.com/spf13/cobra/doc",
        "golang.org/x/net/html",
        "go.uber.org/zap/zapcore",
        "k8s.io/client-go/kubernetes",
        "github.com/owner/repo/v2/pkg/thing",
        "C",
      ],
      "internal/server/server.go": ["github.com/acme/tool/internal/server"],
      "internal/server/handler.go": [],
      "internal/server/routes.go": [],
      "internal/server/server_test.go": [],
      "tools/gen/gen.go": [],
    },
    omitted: ["internal/server/routes.go"],
  });

  it("resolves module-internal packages to every non-test graph file of the directory", () => {
    expect(repo.target(main, "github.com/acme/tool/internal/server")).toBe(
      "internal/server/server.go",
    );
    expect(repo.edgePairs().filter((pair) => pair.startsWith(main))).toEqual([
      `${main} -> internal/server/handler.go`,
      `${main} -> internal/server/server.go`,
      `${main} -> tools/gen/gen.go`,
    ]);
  });

  it("uses the longest module path for nested modules", () => {
    expect(repo.target(main, "github.com/acme/tool/tools/gen")).toBe("tools/gen/gen.go");
  });

  it("leaves module paths without a package directory unresolved", () => {
    const ref = repo.ref(main, "github.com/acme/tool/internal/missing");
    expect(ref.external).toBe(false);
    expect(ref.resolvedFileId).toBeUndefined();
  });

  it("names standard-library imports by full path and third-party imports by module", () => {
    const names = repo.result.externalPackages.map((pkg) => pkg.name).sort();
    expect(names).toEqual([
      "C",
      "fmt",
      "github.com/owner/repo/v2",
      "github.com/spf13/cobra",
      "go.uber.org/zap",
      "golang.org/x/net",
      "k8s.io/client-go",
      "net/http",
    ]);
  });

  it("does not create self-edges for a package importing its own path", () => {
    const edges = repo.result.edges.filter(
      (edge) => edge.source === "file:internal/server/server.go",
    );
    expect(edges.map((edge) => edge.target)).toEqual(["file:internal/server/handler.go"]);
  });
});
