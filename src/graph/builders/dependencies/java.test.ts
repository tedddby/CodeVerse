import { describe, expect, it } from "vitest";
import { resolveMiniRepository } from "./test-support";

describe("Java resolution", () => {
  const main = "core/src/main/java/com/acme/app/App.java";
  const repo = resolveMiniRepository({
    sources: {
      [main]: [
        "com.acme.util.Strings",
        "com.acme.model.*",
        "com.acme.util.Strings.join",
        "com.acme.util.Strings.Builder",
        { specifier: "com.acme.util", names: ["*"] },
        "java.util.List",
        "javax.inject.Inject",
        "org.junit.jupiter.api.Test",
        "com.acme.generated.ProtoMessage",
        "com.acme.model.Item",
      ],
      "core/src/main/java/com/acme/util/Strings.java": ["com.acme.util.Strings"],
      "core/src/main/java/com/acme/model/User.java": [],
      "core/src/main/java/com/acme/model/Order.java": [],
      "api/src/main/java/com/acme/util/Strings.java": [],
    },
    packages: {
      [main]: "com.acme.app",
      "core/src/main/java/com/acme/util/Strings.java": "com.acme.util",
      "core/src/main/java/com/acme/model/User.java": "com.acme.model",
      "core/src/main/java/com/acme/model/Order.java": "com.acme.model",
      "api/src/main/java/com/acme/util/Strings.java": "com.acme.util",
    },
    // Not parsed: indexed from the learned source root.
    files: ["core/src/main/java/com/acme/model/Item.java"],
    omitted: ["core/src/main/java/com/acme/model/Order.java"],
  });

  it("resolves single-type imports to the nearest class file (multi-module builds)", () => {
    expect(repo.target(main, "com.acme.util.Strings")).toBe(
      "core/src/main/java/com/acme/util/Strings.java",
    );
  });

  it("resolves wildcard imports to every file of the package, only graph files becoming edges", () => {
    const edges = repo.edgePairs().filter((pair) => pair.includes("/model/"));
    expect(edges).toEqual([
      `${main} -> core/src/main/java/com/acme/model/Item.java`,
      `${main} -> core/src/main/java/com/acme/model/User.java`,
    ]);
    // `import com.acme.util.*` expressed through names.
    expect(repo.ref(main, "com.acme.util").resolvedFileId).toBeDefined();
  });

  it("resolves static and nested-class imports by progressively shorter prefixes", () => {
    const strings = "core/src/main/java/com/acme/util/Strings.java";
    expect(repo.target(main, "com.acme.util.Strings.join")).toBe(strings);
    expect(repo.target(main, "com.acme.util.Strings.Builder")).toBe(strings);
  });

  it("indexes unparsed files from source roots learned from parsed files", () => {
    expect(repo.target(main, "com.acme.model.Item")).toBe(
      "core/src/main/java/com/acme/model/Item.java",
    );
  });

  it("names external packages by their first two segments", () => {
    const names = repo.result.externalPackages.map((pkg) => pkg.name).sort();
    expect(names).toEqual(["java.util", "javax.inject", "org.junit"]);
    expect(repo.result.externalPackages.every((pkg) => pkg.language === "java")).toBe(true);
  });

  it("treats unknown classes in the repository's own packages as unresolved, not external", () => {
    const ref = repo.ref(main, "com.acme.generated.ProtoMessage");
    expect(ref.external).toBe(false);
    expect(ref.resolvedFileId).toBeUndefined();
  });

  it("never links a class to itself", () => {
    const self = "core/src/main/java/com/acme/util/Strings.java";
    expect(repo.ref(self, "com.acme.util.Strings").resolvedFileId).toBeUndefined();
    expect(repo.result.statsByPath.get(self)?.importsResolved).toBe(1);
  });
});

describe("Java external classification", () => {
  it("keeps other projects of a shared organization external", () => {
    const app = "src/main/java/com/google/myproject/App.java";
    const repo = resolveMiniRepository({
      sources: {
        [app]: ["com.google.common.collect.ImmutableList", "com.google.myproject.gen.Proto"],
      },
      packages: { [app]: "com.google.myproject" },
    });
    expect(repo.ref(app, "com.google.common.collect.ImmutableList").external).toBe(true);
    expect(repo.result.externalPackages.map((pkg) => pkg.name)).toEqual(["com.google"]);
    expect(repo.ref(app, "com.google.myproject.gen.Proto").external).toBe(false);
  });
});

describe("Java resolution without parse results", () => {
  it("falls back to Maven/Gradle source-root conventions", () => {
    const repo = resolveMiniRepository({
      sources: { "src/test/java/org/demo/AppTest.java": ["org.demo.App", "org.demo.util.*"] },
      files: ["src/main/java/org/demo/App.java", "src/main/java/org/demo/util/Io.java"],
    });
    expect(repo.target("src/test/java/org/demo/AppTest.java", "org.demo.App")).toBe(
      "src/main/java/org/demo/App.java",
    );
    expect(repo.target("src/test/java/org/demo/AppTest.java", "org.demo.util.*")).toBe(
      "src/main/java/org/demo/util/Io.java",
    );
  });
});
