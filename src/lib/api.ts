/**
 * The single boundary between the UI and the Rust backend.
 *
 * Every filesystem call is async and takes an absolute path. The prototype this
 * replaced held the whole tree in memory and mutated it synchronously, which is
 * why nothing here returns "the new state": there is no state to return, only a
 * disk that has changed and a directory worth re-listing.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type Category =
  | "folder"
  | "code"
  | "document"
  | "spreadsheet"
  | "presentation"
  | "pdf"
  | "image"
  | "video"
  | "audio"
  | "archive"
  | "executable"
  | "font"
  | "config"
  | "database"
  | "disk"
  | "book"
  | "other";

export interface Entry {
  path: string;
  name: string;
  kind: "dir" | "file";
  size: number;
  /** Seconds since the Unix epoch, 0 when the platform withheld it. */
  mtime: number;
  mode: number;
  isHidden: boolean;
  isSymlink: boolean;
  symlinkTarget: string | null;
  isReadonly: boolean;
  mime: string | null;
  category: Category;
  childCount: number | null;
}

export interface TextFile {
  text: string;
  truncated: boolean;
  size: number;
  isUtf8: boolean;
}

export interface Place {
  label: string;
  path: string;
  icon: string;
}

export interface SearchHit {
  entry: Entry;
  parent: string;
}

export type ProviderId = "anthropic" | "openai" | "xai" | "openrouter" | "ollama";

export interface AiSettings {
  provider: ProviderId;
  model: string;
  baseUrl: string | null;
  maxTokens: number;
  timeoutMs: number;
  allowFileActions: boolean;
}

export interface EditorSettings {
  fontFamily: string;
  fontSize: number;
  tabSize: number;
  insertSpaces: boolean;
  wordWrap: boolean;
  minimap: boolean;
  lineNumbers: boolean;
  formatOnSave: boolean;
  inlineSuggestions: boolean;
  bracketPairColorization: boolean;
}

export interface ViewSettings {
  showHidden: boolean;
  viewMode: "icons" | "details" | "compact" | "tree";
  sortBy: "name" | "size" | "mtime" | "category";
  sortDesc: boolean;
  dualPane: boolean;
  iconPack: string;
  theme: string;
  confirmDelete: boolean;
  singleClickOpen: boolean;
}

export interface Settings {
  ai: AiSettings;
  editor: EditorSettings;
  view: ViewSettings;
  bookmarks: string[];
  terminalShell: string | null;
}

export interface ProviderStatus {
  provider: ProviderId;
  needsKey: boolean;
  hasKey: boolean;
  defaultModel: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatReply {
  text: string;
  provider: string;
  model: string;
}

/**
 * Errors cross the IPC boundary as `{ kind, message }`. Anything that reaches
 * the UI as a bare string is a bug on the Rust side, so it is normalised here
 * rather than being allowed to render as "[object Object]".
 */
export type ErrorKind =
  | "io"
  | "denied"
  | "notFound"
  | "notEmpty"
  | "invalidPath"
  | "exists"
  | "terminal"
  | "settings"
  | "provider"
  | "unknown";

export class FsError extends Error {
  readonly kind: ErrorKind;
  constructor(kind: ErrorKind, message: string) {
    super(message);
    this.name = "FsError";
    this.kind = kind;
  }
}

export function toFsError(e: unknown): FsError {
  if (e instanceof FsError) return e;
  if (e && typeof e === "object" && "kind" in e && "message" in e) {
    const o = e as { kind: string; message: string };
    return new FsError(o.kind as ErrorKind, o.message);
  }
  return new FsError("unknown", typeof e === "string" ? e : String(e));
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    throw toFsError(e);
  }
}

/* Filesystem ------------------------------------------------------------- */

export const listDir = (path: string, showHidden: boolean) =>
  call<Entry[]>("list_dir", { path, showHidden });

export const statPath = (path: string) => call<Entry>("stat_path", { path });

export const readTextFile = (path: string, maxBytes?: number) =>
  call<TextFile>("read_text_file", { path, maxBytes: maxBytes ?? null });

export const writeTextFile = (path: string, content: string) =>
  call<void>("write_text_file", { path, content });

export const createDir = (path: string) => call<void>("create_dir", { path });
export const createFile = (path: string) => call<void>("create_file", { path });

export const renamePath = (from: string, to: string) =>
  call<void>("rename_path", { from, to });

export const copyPath = (from: string, toDir: string) =>
  call<string>("copy_path", { from, toDir });

export const movePath = (from: string, toDir: string) =>
  call<string>("move_path", { from, toDir });

export const trashPaths = (paths: string[]) => call<void>("trash_path", { paths });

export const deletePermanent = (paths: string[]) =>
  call<void>("delete_permanent", { paths });

export const homeDir = () => call<string>("home_dir");
export const places = () => call<Place[]>("places");

export const searchFiles = (
  root: string,
  query: string,
  maxResults?: number,
  maxDepth?: number,
) =>
  call<SearchHit[]>("search_files", {
    root,
    query,
    maxResults: maxResults ?? null,
    maxDepth: maxDepth ?? null,
  });

export const dirSize = (path: string) => call<number>("dir_size", { path });
export const readPreview = (path: string) => call<string>("read_preview", { path });

/* Terminal --------------------------------------------------------------- */

export const spawnTerminal = (cwd: string, cols: number, rows: number) =>
  call<string>("spawn_terminal", { cwd, cols, rows });

export const writeTerminal = (id: string, data: string) =>
  call<void>("write_terminal", { id, data });

export const resizeTerminal = (id: string, cols: number, rows: number) =>
  call<void>("resize_terminal", { id, cols, rows });

export const closeTerminal = (id: string) => call<void>("close_terminal", { id });

export const onTerminalOutput = (fn: (p: { id: string; data: string }) => void) =>
  listen<{ id: string; data: string }>("terminal-output", (e) => fn(e.payload));

export const onTerminalExit = (fn: (p: { id: string; code: number | null }) => void) =>
  listen<{ id: string; code: number | null }>("terminal-exit", (e) => fn(e.payload));

/* Watching --------------------------------------------------------------- */

export const watchDir = (path: string) => call<void>("watch_dir", { path });
export const unwatchDir = (path: string) => call<void>("unwatch_dir", { path });
export const retainWatches = (keep: string[]) => call<void>("retain_watches", { keep });

export const onFsChanged = (fn: (path: string) => void): Promise<UnlistenFn> =>
  listen<{ path: string }>("fs-changed", (e) => fn(e.payload.path));

/* Settings and providers -------------------------------------------------- */

export const getSettings = () => call<Settings>("get_settings");
export const saveSettings = (settings: Settings) => call<void>("save_settings", { settings });

export const setProviderKey = (provider: ProviderId, key: string) =>
  call<void>("set_provider_key", { provider, key });

export const hasProviderKey = (provider: ProviderId) =>
  call<boolean>("has_provider_key", { provider });

export const deleteProviderKey = (provider: ProviderId) =>
  call<void>("delete_provider_key", { provider });

export const providerStatus = () => call<ProviderStatus[]>("provider_status");

export const aiChat = (
  messages: ChatMessage[],
  system?: string,
  provider?: ProviderId,
  model?: string,
) =>
  call<ChatReply>("ai_chat", {
    messages,
    system: system ?? null,
    provider: provider ?? null,
    model: model ?? null,
  });

/* Path helpers ------------------------------------------------------------ */

export function parentOf(path: string): string {
  if (path === "/") return "/";
  const trimmed = path.replace(/\/+$/, "");
  const cut = trimmed.lastIndexOf("/");
  return cut <= 0 ? "/" : trimmed.slice(0, cut);
}

export function joinPath(dir: string, name: string): string {
  return dir === "/" ? `/${name}` : `${dir}/${name}`;
}

export function basename(path: string): string {
  if (path === "/") return "/";
  const trimmed = path.replace(/\/+$/, "");
  return trimmed.slice(trimmed.lastIndexOf("/") + 1);
}

/** Breadcrumb segments, each with the absolute path it navigates to. */
export function crumbs(path: string): { label: string; path: string }[] {
  const out = [{ label: "/", path: "/" }];
  let acc = "";
  for (const part of path.split("/").filter(Boolean)) {
    acc += `/${part}`;
    out.push({ label: part, path: acc });
  }
  return out;
}
