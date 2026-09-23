import type { Node } from "web-tree-sitter";
import type { ExtractionBuilder, Visibility } from "@/parser/extract/builder";
import { textOf } from "@/parser/extract/nodes";
import { headSignature, isFollowedByOverload, nameFromNode, unwrapExpression } from "./syntax";
import { FUNCTION_EXPRESSIONS, ecmascript as es } from "./vocabulary";

/**
 * Class members that become `method` symbols: methods (including constructors,
 * accessors and generators), abstract/overload signatures, and fields whose
 * value is a function (`handle = () => {}`). Public members inherit the
 * class's visibility; `private`/`protected`/`#private` members are hidden.
 */
export function addClassMember(
  builder: ExtractionBuilder,
  source: string,
  node: Node,
  parentIndex: number,
): void {
  switch (es.typeOf(node)) {
    case "method_definition":
      addMethod(builder, source, node, es.field(node, "name"), es.field(node, "body"), parentIndex);
      break;
    case "method_signature":
    case "abstract_method_signature":
      if (!isFollowedByOverload(source, node, node, true)) {
        addMethod(builder, source, node, es.field(node, "name"), null, parentIndex);
      }
      break;
    case "public_field_definition":
    case "field_definition": {
      const rawValue = es.field(node, "value");
      const value = rawValue ? unwrapExpression(rawValue) : null;
      if (!value || !es.is(value, ...FUNCTION_EXPRESSIONS)) break;
      // TypeScript names the field `name`, JavaScript `property`.
      const nameNode = es.field(node, "name") ?? es.field(node, "property");
      addMethod(builder, source, node, nameNode, es.field(value, "body"), parentIndex);
      break;
    }
    default:
      break;
  }
}

function addMethod(
  builder: ExtractionBuilder,
  source: string,
  node: Node,
  nameNode: Node | null,
  body: Node | null,
  parentIndex: number,
): void {
  const name = nameNode ? nameFromNode(source, nameNode) : null;
  if (!nameNode || !name) return;
  const isPrivate =
    es.is(nameNode, "private_property_identifier") ||
    node.namedChildren.some(
      (child) => es.is(child, "accessibility_modifier") && textOf(source, child) !== "public",
    );
  const visibility: Visibility = isPrivate ? "hidden" : "inherit";
  builder.addSymbol({
    name,
    kind: "method",
    range: node,
    rangeStart: leadingDecorator(node),
    visibility,
    parentIndex,
    signature: headSignature(source, node, body),
  });
}

/** Method decorators are siblings in the class body; the method's lines include them. */
function leadingDecorator(node: Node): Node {
  let start = node;
  for (
    let previous = node.previousNamedSibling;
    previous && es.is(previous, "decorator");
    previous = previous.previousNamedSibling
  ) {
    start = previous;
  }
  return start;
}
