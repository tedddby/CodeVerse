import type { Node } from "web-tree-sitter";
import type { ExtractionBuilder } from "@/parser/extract/builder";
import { cleanName, textOf } from "@/parser/extract/nodes";
import { literalValue } from "./modules";
import { FUNCTION_EXPRESSIONS, ecmascript as es } from "./vocabulary";

export interface CommonJsDeclaration {
  name: string;
  value: Node;
  /** `module.exports = ...` (the module's default export) rather than `exports.name = ...`. */
  isDefault: boolean;
}

/**
 * CommonJS export detection for file-level assignments:
 *
 *   module.exports = { a, b: c }   -> exports "a", "b"; locals a and c become exported
 *   module.exports = handler       -> exports "default"; local handler becomes exported
 *   module.exports = function f(){} -> exports "default"; declares f
 *   exports.name = ... / module.exports.name = ... -> exports "name"
 *
 * Returns the function/class assignment that deserves its own symbol, or null.
 */
export function exportsFromCommonJs(
  builder: ExtractionBuilder,
  source: string,
  assignment: Node,
): CommonJsDeclaration | null {
  const left = es.field(assignment, "left");
  const right = es.field(assignment, "right");
  if (!left || !right || !es.is(left, "member_expression")) return null;

  if (isModuleExports(source, left)) {
    builder.addExport("default");
    if (es.is(right, "object")) {
      exportObjectMembers(builder, source, right);
      return null;
    }
    if (es.is(right, "identifier")) {
      builder.exportLocal(textOf(source, right));
      return null;
    }
    if (es.is(right, "class", ...FUNCTION_EXPRESSIONS)) {
      const nameNode = es.field(right, "name");
      return nameNode
        ? { name: cleanName(textOf(source, nameNode)), value: right, isDefault: true }
        : null;
    }
    return null;
  }

  const object = es.field(left, "object");
  const property = es.field(left, "property");
  if (!object || !property || !es.is(property, "property_identifier")) return null;
  const isExportsObject =
    (es.is(object, "identifier") && textOf(source, object) === "exports") ||
    (es.is(object, "member_expression") && isModuleExports(source, object));
  if (!isExportsObject) return null;

  const name = textOf(source, property);
  builder.addExport(name);
  if (es.is(right, "identifier")) {
    builder.exportLocal(textOf(source, right));
    return null;
  }
  return { name, value: right, isDefault: false };
}

/** `module.exports` (exactly). */
function isModuleExports(source: string, node: Node): boolean {
  const object = es.field(node, "object");
  const property = es.field(node, "property");
  return (
    object !== null &&
    property !== null &&
    es.is(object, "identifier") &&
    textOf(source, object) === "module" &&
    textOf(source, property) === "exports"
  );
}

function exportObjectMembers(builder: ExtractionBuilder, source: string, object: Node): void {
  for (const member of object.namedChildren) {
    if (es.is(member, "shorthand_property_identifier")) {
      const name = textOf(source, member);
      builder.addExport(name);
      builder.exportLocal(name);
    } else if (es.is(member, "pair")) {
      const key = es.field(member, "key");
      const value = es.field(member, "value");
      const name = key ? keyName(source, key) : null;
      if (!name) continue;
      builder.addExport(name);
      if (value && es.is(value, "identifier")) builder.exportLocal(textOf(source, value));
    } else if (es.is(member, "method_definition")) {
      const nameNode = es.field(member, "name");
      if (nameNode) builder.addExport(cleanName(textOf(source, nameNode)));
    }
  }
}

function keyName(source: string, key: Node): string | null {
  if (es.is(key, "property_identifier", "identifier")) return textOf(source, key);
  if (es.is(key, "string")) return literalValue(source, key);
  return null;
}
