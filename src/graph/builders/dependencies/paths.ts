import { parentPath } from "@/graph/model/ids";

/**
 * POSIX path math for repository-relative paths ("" is the repository root).
 * Every function is pure; nothing touches a real filesystem.
 */

/**
 * Joins a repository directory with a relative (or root-relative "/x") path and
 * normalizes "." / ".." / empty segments. Returns null when the result would
 * escape the repository root.
 */
export function joinPath(directory: string, relative: string): string | null {
  const segments: string[] = [];
  const base = relative.startsWith("/") ? "" : directory;
  for (const segment of `${base}/${relative}`.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return null;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.join("/");
}

/** Whether `path` is `directory` itself or lies below it ("" contains everything). */
export function isWithin(path: string, directory: string): boolean {
  return directory === "" || path === directory || path.startsWith(`${directory}/`);
}

/** Path of `path` relative to an ancestor `directory` (which must contain it). */
export function relativeTo(path: string, directory: string): string {
  if (directory === "") return path;
  return path === directory ? "" : path.slice(directory.length + 1);
}

/** Ancestor directories of a path, nearest first, ending with the root "". */
export function ancestorDirectories(path: string): string[] {
  const result: string[] = [];
  let directory = parentPath(path);
  for (;;) {
    result.push(directory);
    if (directory === "") return result;
    directory = parentPath(directory);
  }
}

/** Removes the final extension of a file name or path ("a/b.ts" -> "a/b"). */
export function stripExtension(path: string): string {
  const slash = path.lastIndexOf("/");
  const dot = path.lastIndexOf(".");
  return dot > slash + 1 ? path.slice(0, dot) : path;
}

/** Length of the shared leading directory prefix of two paths, in segments. */
export function sharedPrefixLength(a: string, b: string): number {
  const left = a.split("/");
  const right = b.split("/");
  let shared = 0;
  while (shared < left.length - 1 && shared < right.length - 1 && left[shared] === right[shared]) {
    shared += 1;
  }
  return shared;
}
