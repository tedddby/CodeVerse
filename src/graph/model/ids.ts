import type { NodeKind, NodeRef } from "./types";

/**
 * Stable id helpers. Ids are derived purely from repository paths so that the
 * same commit always produces the same ids (required for deterministic layout,
 * shareable selection links and cache reuse).
 */

export const ROOT_DIRECTORY_ID = "dir:";

export function directoryId(path: string): string {
  return `dir:${path}`;
}

export function fileId(path: string): string {
  return `file:${path}`;
}

export function symbolId(filePath: string, name: string, startLine: number): string {
  return `sym:${filePath}#${name}@${startLine}`;
}

export function dependencyEdgeId(kind: string, source: string, target: string): string {
  return `${kind}:${source}->${target}`;
}

export function contributorIdFromLogin(login: string): string {
  return `user:${login.toLowerCase()}`;
}

export function contributorIdFromName(name: string): string {
  return `author:${name.trim().toLowerCase().replace(/\s+/g, " ")}`;
}

/** Returns the path encoded in a directory or file id, or null for other ids. */
export function pathFromId(id: string): string | null {
  if (id.startsWith("dir:")) return id.slice(4);
  if (id.startsWith("file:")) return id.slice(5);
  return null;
}

export function kindFromId(id: string): NodeKind | null {
  if (id.startsWith("dir:")) return "directory";
  if (id.startsWith("file:")) return "file";
  if (id.startsWith("sym:")) return "symbol";
  return null;
}

export function nodeRefFromId(id: string): NodeRef | null {
  const kind = kindFromId(id);
  return kind ? { kind, id } : null;
}

/** Parent directory path of a POSIX path ("src/a/b.ts" -> "src/a", "b.ts" -> ""). */
export function parentPath(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

/** Last segment of a POSIX path. */
export function baseName(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? path : path.slice(index + 1);
}

/** Lower-case extension without the dot. Dotfiles like ".gitignore" have no extension. */
export function extensionOf(name: string): string {
  const index = name.lastIndexOf(".");
  if (index <= 0 || index === name.length - 1) return "";
  return name.slice(index + 1).toLowerCase();
}
