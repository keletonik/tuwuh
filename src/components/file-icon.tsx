/**
 * Categorical file icons.
 *
 * The category is decided in Rust from the extension, and from the executable
 * bit when there is no extension, so the icon here is a lookup rather than a
 * second guess that could disagree with the backend. Colour carries the same
 * information as the glyph, but colour alone never does: every category has a
 * distinct shape as well, so the grid stays readable without relying on hue.
 */
import {
  Archive,
  Binary,
  Book,
  Braces,
  Database,
  Disc,
  FileAudio,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  File as FileGeneric,
  Folder,
  FolderOpen,
  Presentation,
  Settings2,
  Type,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Category, Entry } from "@/lib/api";

const GLYPH: Record<Category, LucideIcon> = {
  folder: Folder,
  code: Braces,
  document: FileText,
  spreadsheet: FileSpreadsheet,
  presentation: Presentation,
  pdf: FileText,
  image: FileImage,
  video: FileVideo,
  audio: FileAudio,
  archive: Archive,
  executable: Binary,
  font: Type,
  config: Settings2,
  database: Database,
  disk: Disc,
  book: Book,
  other: FileGeneric,
};

export function FileIcon({
  entry,
  size = 16,
  open = false,
}: {
  entry: Pick<Entry, "category" | "kind" | "isSymlink">;
  size?: number;
  open?: boolean;
}) {
  const Icon = entry.kind === "dir" && open ? FolderOpen : (GLYPH[entry.category] ?? FileGeneric);
  // The tone variable is named after the category, so a theme that defines a
  // tone for every category cannot leave one icon on a stale colour.
  const tone = `var(--fm-tone-${entry.category})`;

  return (
    <span className="fm-icon" data-category={entry.category}>
      <Icon size={size} strokeWidth={1.75} style={{ color: tone }} />
      {entry.isSymlink && (
        // A link and its target look identical otherwise, and acting on the
        // wrong one is the mistake this badge exists to prevent.
        <span className="fm-icon-link" aria-label="symbolic link" title="symbolic link" />
      )}
    </span>
  );
}

export const categoryLabel: Record<Category, string> = {
  folder: "Folder",
  code: "Code",
  document: "Document",
  spreadsheet: "Spreadsheet",
  presentation: "Presentation",
  pdf: "PDF",
  image: "Image",
  video: "Video",
  audio: "Audio",
  archive: "Archive",
  executable: "Executable",
  font: "Font",
  config: "Configuration",
  database: "Database",
  disk: "Disk image",
  book: "Book",
  other: "File",
};
