/**
 * Listing order. Directories lead unless the user turns that off; descending
 * still reverses within each group so folders do not sink under files.
 */

export type SortKey = "name" | "size" | "mtime" | "category";

export interface Sortable {
  path: string;
  name: string;
  kind: "dir" | "file";
  size: number;
  mtime: number;
  category: string;
}

export function sortEntries<T extends Sortable>(
  entries: T[],
  by: SortKey,
  desc: boolean,
  foldersFirst = true,
): T[] {
  const cmp = (a: T, b: T) => {
    if (foldersFirst && a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
    switch (by) {
      case "size":
        return a.size - b.size;
      case "mtime":
        return a.mtime - b.mtime;
      case "category":
        return a.category.localeCompare(b.category) || a.name.localeCompare(b.name);
      default:
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    }
  };
  const out = [...entries].sort(cmp);
  if (!desc) return out;
  if (!foldersFirst) return out.reverse();
  const dirs = out.filter((e) => e.kind === "dir").reverse();
  const files = out.filter((e) => e.kind === "file").reverse();
  return [...dirs, ...files];
}
