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

interface Look {
  Icon: LucideIcon;
  /** CSS custom property name from the active theme. */
  tone: string;
}

const LOOK: Record<Category, Look> = {
  folder: { Icon: Folder, tone: "--fm-accent" },
  code: { Icon: Braces, tone: "--fm-code" },
  document: { Icon: FileText, tone: "--fm-doc" },
  spreadsheet: { Icon: FileSpreadsheet, tone: "--fm-sheet" },
  presentation: { Icon: Presentation, tone: "--fm-slide" },
  pdf: { Icon: FileText, tone: "--fm-pdf" },
  image: { Icon: FileImage, tone: "--fm-image" },
  video: { Icon: FileVideo, tone: "--fm-video" },
  audio: { Icon: FileAudio, tone: "--fm-audio" },
  archive: { Icon: Archive, tone: "--fm-archive" },
  executable: { Icon: Binary, tone: "--fm-exec" },
  font: { Icon: Type, tone: "--fm-font" },
  config: { Icon: Settings2, tone: "--fm-config" },
  database: { Icon: Database, tone: "--fm-db" },
  disk: { Icon: Disc, tone: "--fm-disk" },
  book: { Icon: Book, tone: "--fm-book" },
  other: { Icon: FileGeneric, tone: "--fm-muted" },
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
  const look = LOOK[entry.category] ?? LOOK.other;
  const Icon = entry.kind === "dir" && open ? FolderOpen : look.Icon;

  return (
    <span className="fm-icon" data-category={entry.category}>
      <Icon size={size} strokeWidth={1.75} style={{ color: `var(${look.tone})` }} />
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
