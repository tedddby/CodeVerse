import { describe, expect, it } from "vitest";
import { expandUseTree } from "./rust";
import { resolveMiniRepository } from "./test-support";

describe("expandUseTree", () => {
  it("flattens nested groups, self and aliases", () => {
    expect(expandUseTree("crate::net::{self, tcp::{Stream, Listener as L}, udp}")).toEqual([
      "crate::net",
      "crate::net::tcp::Stream",
      "crate::net::tcp::Listener",
      "crate::net::udp",
    ]);
    expect(expandUseTree("std::io::Read")).toEqual(["std::io::Read"]);
    expect(expandUseTree("{crate::a, std::fmt}")).toEqual(["crate::a", "std::fmt"]);
  });
});

describe("Rust resolution", () => {
  const lib = "crates/core/src/lib.rs";
  const parser = "crates/core/src/parser.rs";
  const lexer = "crates/core/src/parser/lexer.rs";
  const netMod = "crates/core/src/net/mod.rs";
  const tcp = "crates/core/src/net/tcp.rs";
  const cliMain = "crates/cli/src/main.rs";

  const repo = resolveMiniRepository({
    configs: {
      "Cargo.toml": `[workspace]\nmembers = ["crates/*"]\n`,
      "crates/core/Cargo.toml": `[package]\nname = "acme-core"\nversion = "0.1.0"\n\n[dependencies]\nserde = { version = "1", features = ["derive"] }\n`,
      "crates/cli/Cargo.toml": `[package]\nname = "acme-cli"\n\n[[bin]]\nname = "acme"\npath = "src/main.rs"\n`,
    },
    sources: {
      [lib]: [
        { specifier: "parser", kind: "module" },
        { specifier: "net", kind: "module" },
        { specifier: "missing", kind: "module" },
        // `mod handlers;` declared inside an inline `pub mod api { ... }`.
        { specifier: "api::handlers", kind: "module" },
        "crate::parser::Token",
        "self::net::tcp::Stream",
      ],
      [parser]: [
        { specifier: "lexer", kind: "module" },
        "super::net::Client",
        "self::lexer::Lexer",
        "lexer::Mode",
        "crate::Error",
      ],
      [lexer]: ["crate::net::{Client, tcp::Stream}", "super::super::net::*", "super::Token"],
      [netMod]: [{ specifier: "tcp", kind: "module" }],
      [tcp]: ["std::io::Read", "core::fmt", "serde::Serialize", "super::super::parser::Token"],
      [cliMain]: [
        "acme_core::parser::Token",
        "acme_core::*",
        "anyhow::Result",
        { specifier: "commands", kind: "module" },
        "crate::commands::run",
      ],
      "crates/cli/src/commands.rs": ["super::super::too_far"],
      "crates/core/tests/integration.rs": [
        { specifier: "common", kind: "module" },
        "acme_core::net",
      ],
      "crates/core/tests/common/mod.rs": [],
      "crates/core/build.rs": [],
      "crates/core/src/api/handlers.rs": [],
    },
  });

  it("resolves `mod` declarations next to mod-rs files and inside directories of non-mod-rs files", () => {
    expect(repo.target(lib, "parser")).toBe(parser);
    expect(repo.target(lib, "net")).toBe(netMod);
    expect(repo.target(lib, "api::handlers")).toBe("crates/core/src/api/handlers.rs");
    expect(repo.target(parser, "lexer")).toBe(lexer);
    expect(repo.target(netMod, "tcp")).toBe(tcp);
    expect(repo.target(cliMain, "commands")).toBe("crates/cli/src/commands.rs");
    expect(repo.target("crates/core/tests/integration.rs", "common")).toBe(
      "crates/core/tests/common/mod.rs",
    );
    expect(repo.ref(lib, "missing")).toMatchObject({ external: false });
    expect(repo.ref(lib, "missing").resolvedFileId).toBeUndefined();
  });

  it("resolves crate::, self:: and super:: paths to the longest module prefix", () => {
    expect(repo.target(lib, "crate::parser::Token")).toBe(parser);
    expect(repo.target(lib, "self::net::tcp::Stream")).toBe(tcp);
    expect(repo.target(parser, "super::net::Client")).toBe(netMod);
    expect(repo.target(parser, "self::lexer::Lexer")).toBe(lexer);
    expect(repo.target(lexer, "super::Token")).toBe(parser);
    expect(repo.target(tcp, "super::super::parser::Token")).toBe(parser);
  });

  it("resolves uniform paths to child modules and items of the crate root", () => {
    expect(repo.target(parser, "lexer::Mode")).toBe(lexer);
    expect(repo.target(parser, "crate::Error")).toBe(lib);
  });

  it("expands use groups into one import with several targets", () => {
    const ref = repo.ref(lexer, "crate::net::{Client, tcp::Stream}");
    expect(ref.resolvedFileId).toBe(`file:${netMod}`);
    expect(repo.edgePairs()).toEqual(
      expect.arrayContaining([`${lexer} -> ${netMod}`, `${lexer} -> ${tcp}`]),
    );
    expect(repo.target(lexer, "super::super::net::*")).toBe(netMod);
  });

  it("resolves workspace crates by their underscored names", () => {
    expect(repo.target(cliMain, "acme_core::parser::Token")).toBe(parser);
    expect(repo.target(cliMain, "acme_core::*")).toBe(lib);
    expect(repo.target("crates/core/tests/integration.rs", "acme_core::net")).toBe(netMod);
  });

  it("treats std/core/alloc as `std` and other crates as external", () => {
    expect(repo.ref(tcp, "std::io::Read").external).toBe(true);
    expect(repo.ref(tcp, "core::fmt").external).toBe(true);
    const names = repo.result.externalPackages.map((pkg) => pkg.name).sort();
    expect(names).toEqual(["anyhow", "serde", "std"]);
    expect(repo.result.externalPackages.find((pkg) => pkg.name === "std")?.importCount).toBe(2);
  });

  it("leaves super:: paths that climb above the crate root unresolved", () => {
    const ref = repo.ref("crates/cli/src/commands.rs", "super::super::too_far");
    expect(ref.external).toBe(false);
    expect(ref.resolvedFileId).toBeUndefined();
  });

  it("keeps totals consistent", () => {
    const { stats } = repo.result;
    expect(stats.importsFound).toBe(
      stats.importsResolved + stats.externalImports + stats.unresolvedImports,
    );
    expect(stats.unresolvedImports).toBe(2);
  });
});
