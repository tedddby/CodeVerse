import { describe, expect, it } from "vitest";
import { resolveMiniRepository } from "./test-support";

describe("Python resolution (src layout)", () => {
  const repo = resolveMiniRepository({
    configs: {
      "pyproject.toml": `[project]\nname = "acme"\n\n[tool.setuptools.packages.find]\nwhere = ["src"]\n`,
    },
    sources: {
      "src/acme/api.py": [
        { specifier: ".core", names: ["models"] },
        { specifier: ".core.utils", names: ["helper"] },
        { specifier: ".", names: ["settings"] },
        { specifier: ".", names: ["VERSION"] },
        "acme.core.models",
        { specifier: "acme.core", names: ["utils", "Thing"] },
        { specifier: "acme.core.models", names: ["User as U"] },
        "numpy",
        "os.path",
        { specifier: "..outside", names: ["x"] },
        { specifier: "...", names: ["nothing"] },
        { specifier: "acme.missing.deep" },
      ],
      "src/acme/__init__.py": [],
      "src/acme/settings.py": [],
      "src/acme/core/__init__.py": [{ specifier: ".", names: ["*"] }],
      "src/acme/core/models.py": [{ specifier: "..", names: ["settings"] }],
      "src/acme/core/utils.py": [],
      "tests/test_api.py": [
        { specifier: "acme.api", names: ["handler"] },
        "conftest",
        "helpers.factories",
      ],
      "tests/conftest.py": [],
      "tests/helpers/__init__.py": [],
      "tests/helpers/factories.py": [],
      "scripts/release.py": ["acme", "requests"],
    },
    files: ["src/acme/core/models.pyi", ".venv/lib/python3.12/site-packages/requests/__init__.py"],
  });
  const api = "src/acme/api.py";

  it("resolves relative imports from the importer's package", () => {
    expect(repo.target(api, ".core")).toBe("src/acme/core/models.py");
    expect(repo.target(api, ".core.utils")).toBe("src/acme/core/utils.py");
    expect(repo.target("src/acme/core/models.py", "..")).toBe("src/acme/settings.py");
  });

  it("treats `from . import name` as a submodule when one exists, else the package __init__", () => {
    const refs = repo.result.importsByPath.get(api) ?? [];
    const fromDot = refs.filter((ref) => ref.specifier === ".");
    expect(fromDot.map((ref) => ref.resolvedFileId)).toEqual([
      "file:src/acme/settings.py",
      "file:src/acme/__init__.py",
    ]);
  });

  it("resolves absolute imports through the src root, including submodules of `from` imports", () => {
    expect(repo.target(api, "acme.core.models")).toBe("src/acme/core/models.py");
    // "utils" is a submodule, "Thing" is not: both the package and the submodule are dependencies.
    const edges = repo.edgePairs().filter((pair) => pair.startsWith(`${api} ->`));
    expect(edges).toEqual(
      expect.arrayContaining([
        `${api} -> src/acme/core/__init__.py`,
        `${api} -> src/acme/core/utils.py`,
      ]),
    );
  });

  it("prefers sources over stubs and resolves the longest importable prefix", () => {
    const refs = repo.result.importsByPath.get(api) ?? [];
    const modelImports = refs.filter((ref) => ref.specifier === "acme.core.models");
    expect(modelImports.every((ref) => ref.resolvedFileId === "file:src/acme/core/models.py")).toBe(
      true,
    );
    expect(repo.target(api, "acme.missing.deep")).toBe("src/acme/__init__.py");
  });

  it("classifies third-party and standard-library modules by top-level name", () => {
    expect(repo.ref(api, "numpy").external).toBe(true);
    expect(repo.ref(api, "os.path").external).toBe(true);
    const names = repo.result.externalPackages.map((pkg) => pkg.name);
    expect(names).toEqual(expect.arrayContaining(["numpy", "os", "requests"]));
    expect(repo.result.externalPackages.find((pkg) => pkg.name === "numpy")?.language).toBe(
      "python",
    );
  });

  it("does not let a committed virtualenv shadow third-party packages", () => {
    expect(repo.ref("scripts/release.py", "requests").external).toBe(true);
    expect(repo.target("scripts/release.py", "acme")).toBe("src/acme/__init__.py");
  });

  it("leaves relative imports that climb out of the source tree unresolved", () => {
    expect(repo.ref(api, "..outside")).toMatchObject({ external: false });
    expect(repo.ref(api, "..outside").resolvedFileId).toBeUndefined();
    expect(repo.ref(api, "...").resolvedFileId).toBeUndefined();
  });

  it("uses the test directory as a script root (pytest rootdir semantics)", () => {
    expect(repo.target("tests/test_api.py", "acme.api")).toBe(api);
    expect(repo.target("tests/test_api.py", "conftest")).toBe("tests/conftest.py");
    expect(repo.target("tests/test_api.py", "helpers.factories")).toBe(
      "tests/helpers/factories.py",
    );
  });
});

describe("Python resolution (flat layout and namespaces)", () => {
  it("resolves top-level packages next to the repository root and prefers the nearest root", () => {
    const repo = resolveMiniRepository({
      sources: {
        "django/core/handlers.py": [
          { specifier: "django.http", names: ["HttpResponse"] },
          "django.utils.text",
        ],
        "django/__init__.py": [],
        "django/core/__init__.py": [],
        "django/http/__init__.py": [],
        "django/utils/__init__.py": [],
        "django/utils/text.py": [],
        "services/billing/app/main.py": ["app.config"],
        "services/billing/app/__init__.py": [],
        "services/billing/app/config.py": [],
        "services/search/app/__init__.py": [],
        "services/search/app/config.py": [],
      },
    });
    expect(repo.target("django/core/handlers.py", "django.http")).toBe("django/http/__init__.py");
    expect(repo.target("django/core/handlers.py", "django.utils.text")).toBe(
      "django/utils/text.py",
    );
    expect(repo.target("services/billing/app/main.py", "app.config")).toBe(
      "services/billing/app/config.py",
    );
  });
});
