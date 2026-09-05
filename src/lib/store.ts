/**
 * Pane and session state.
 *
 * The store is a cache over the filesystem, never the source of truth. Each
 * pane holds the directory it is showing and the entries last read for it;
 * anything that changes the disk re-reads rather than patching the cache, so a
 * change made in a terminal or another program cannot leave the view lying.
 */
import { create } from "zustand";
import {
  listDir,
  parentOf,
  retainWatches,
  saveSettings,
  watchDir,
  type Entry,
  type Settings,
  type ViewSettings,
} from "./api";
import { parseTerminalDock } from "./layout";

export type PaneId = "a" | "b";

export interface Pane {
  cwd: string;
  entries: Entry[];
  loading: boolean;
  error: string | null;
  selected: string[];
  /** Anchor for shift-click range selection. */
  anchor: string | null;
  history: string[];
  historyIndex: number;
}

export interface OpenTab {
  path: string;
  name: string;
  /** Saved contents as last read, used to decide whether a buffer is dirty. */
  original: string;
  draft: string;
  truncated: boolean;
  readonly: boolean;
}

export interface TermTab {
  id: string;
  cwd: string;
}

function normalizeSettings(s: Settings): Settings {
  const theme = s.view.theme;
  return {
    ...s,
    ai: {
      ...s.ai,
      models: s.ai.models ?? {},
    },
    view: {
      ...s.view,
      terminalDock: parseTerminalDock(s.view.terminalDock),
      // "system" was the old Rust default and is not a derived theme.
      theme: !theme || theme === "system" ? "forest" : theme,
      restoreLast: s.view.restoreLast !== false,
    },
    lastPaths: s.lastPaths ?? [],
    terminalShell: s.terminalShell ?? null,
  };
}

function persist(get: () => State) {
  const s = get().settings;
  if (!s) return;
  void saveSettings(s).catch((e) => {
    get().toast("error", e instanceof Error ? e.message : String(e));
  });
}

export interface Toast {
  id: number;
  kind: "info" | "error" | "success";
  text: string;
}

function emptyPane(cwd: string): Pane {
  return {
    cwd,
    entries: [],
    loading: false,
    error: null,
    selected: [],
    anchor: null,
    history: [cwd],
    historyIndex: 0,
  };
}

interface State {
  ready: boolean;
  home: string;
  settings: Settings | null;

  panes: Record<PaneId, Pane>;
  activePane: PaneId;

  tabs: OpenTab[];
  activeTab: string | null;

  terminals: TermTab[];
  activeTerminal: string | null;
  infoOpen: boolean;
  settingsOpen: boolean;
  assistantOpen: boolean;
  menuOpen: boolean;

  toasts: Toast[];

  boot: (home: string, settings: Settings) => Promise<void>;
  navigate: (pane: PaneId, path: string, pushHistory?: boolean) => Promise<void>;
  refresh: (pane?: PaneId) => Promise<void>;
  refreshPath: (path: string) => Promise<void>;
  goBack: (pane: PaneId) => Promise<void>;
  goForward: (pane: PaneId) => Promise<void>;
  goUp: (pane: PaneId) => Promise<void>;

  select: (pane: PaneId, path: string, mode: "set" | "toggle" | "range") => void;
  clearSelection: (pane: PaneId) => void;
  setActivePane: (pane: PaneId) => void;

  openTab: (entry: Entry, text: string, truncated: boolean) => void;
  closeTab: (path: string) => void;
  setDraft: (path: string, draft: string) => void;
  markSaved: (path: string) => void;
  setActiveTab: (path: string | null) => void;

  applyView: (patch: Partial<ViewSettings>) => void;
  setSettings: (s: Settings) => void;
  persistSettings: () => Promise<void>;
  closeSettings: () => Promise<void>;

  toast: (kind: Toast["kind"], text: string) => void;
  dismissToast: (id: number) => void;

  addTerminal: (cwd: string) => void;
  closeTerminalTab: (id: string) => void;
  closeAllTerminals: () => void;
  setActiveTerminal: (id: string) => void;
  setInfoOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setAssistantOpen: (open: boolean) => void;
  setMenuOpen: (open: boolean) => void;
}

let termSeq = 1;

let toastSeq = 1;

export const useApp = create<State>((set, get) => ({
  ready: false,
  home: "/",
  settings: null,

  panes: { a: emptyPane("/"), b: emptyPane("/") },
  activePane: "a",

  tabs: [],
  activeTab: null,

  terminals: [],
  activeTerminal: null,
  infoOpen: true,
  settingsOpen: false,
  assistantOpen: false,
  menuOpen: false,

  toasts: [],

  async boot(home, settings) {
    const normalised = normalizeSettings(settings);
    set({
      home,
      settings: normalised,
      panes: { a: emptyPane(home), b: emptyPane(home) },
      ready: true,
    });
    const startA =
      normalised.view.restoreLast && normalised.lastPaths[0] ? normalised.lastPaths[0] : home;
    const startB =
      normalised.view.restoreLast && normalised.lastPaths[1] ? normalised.lastPaths[1] : startA;
    await get().navigate("a", startA, false);
    if (normalised.view.dualPane) await get().navigate("b", startB, false);
  },

  async navigate(pane, path, pushHistory = true) {
    const showHidden = get().settings?.view.showHidden ?? false;
    set((s) => ({
      panes: { ...s.panes, [pane]: { ...s.panes[pane], loading: true, error: null } },
    }));

    try {
      const entries = await listDir(path, showHidden);
      set((s) => {
        const prev = s.panes[pane];
        // Truncate any forward history: navigating somewhere new from a
        // back-stepped position should not leave a stale forward branch.
        const history = pushHistory
          ? [...prev.history.slice(0, prev.historyIndex + 1), path]
          : prev.history;
        return {
          panes: {
            ...s.panes,
            [pane]: {
              ...prev,
              cwd: path,
              entries,
              loading: false,
              error: null,
              selected: [],
              anchor: null,
              history,
              historyIndex: pushHistory ? history.length - 1 : prev.historyIndex,
            },
          },
        };
      });

      // Watch only what is on screen, so inotify slots track the visible panes.
      const open = Object.values(get().panes).map((p) => p.cwd);
      await retainWatches(open).catch(() => undefined);
      await watchDir(path).catch(() => undefined);

      const st = get();
      if (st.settings) {
        const lastPaths = [st.panes.a.cwd, st.panes.b.cwd];
        set({ settings: { ...st.settings, lastPaths } });
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      set((s) => ({
        panes: {
          ...s.panes,
          [pane]: { ...s.panes[pane], loading: false, error: message },
        },
      }));
    }
  },

  async refresh(pane) {
    const target = pane ?? get().activePane;
    const { cwd } = get().panes[target];
    const showHidden = get().settings?.view.showHidden ?? false;
    try {
      const entries = await listDir(cwd, showHidden);
      set((s) => ({
        panes: {
          ...s.panes,
          [target]: {
            ...s.panes[target],
            entries,
            // Drop selections for entries that no longer exist, or a delete
            // would leave phantom paths selected and the next action would
            // target something that is gone.
            selected: s.panes[target].selected.filter((p) =>
              entries.some((e) => e.path === p),
            ),
          },
        },
      }));
    } catch (e) {
      set((s) => ({
        panes: {
          ...s.panes,
          [target]: {
            ...s.panes[target],
            error: e instanceof Error ? e.message : String(e),
          },
        },
      }));
    }
  },

  /** Refresh whichever panes are showing `path`, used by the fs watcher. */
  async refreshPath(path) {
    const { panes } = get();
    for (const id of ["a", "b"] as PaneId[]) {
      if (panes[id].cwd === path) await get().refresh(id);
    }
  },

  async goBack(pane) {
    const p = get().panes[pane];
    if (p.historyIndex <= 0) return;
    const index = p.historyIndex - 1;
    set((s) => ({
      panes: { ...s.panes, [pane]: { ...s.panes[pane], historyIndex: index } },
    }));
    await get().navigate(pane, p.history[index], false);
  },

  async goForward(pane) {
    const p = get().panes[pane];
    if (p.historyIndex >= p.history.length - 1) return;
    const index = p.historyIndex + 1;
    set((s) => ({
      panes: { ...s.panes, [pane]: { ...s.panes[pane], historyIndex: index } },
    }));
    await get().navigate(pane, p.history[index], false);
  },

  async goUp(pane) {
    const { cwd } = get().panes[pane];
    if (cwd === "/") return;
    await get().navigate(pane, parentOf(cwd));
  },

  select(pane, path, mode) {
    set((s) => {
      const p = s.panes[pane];
      if (mode === "set") {
        return { panes: { ...s.panes, [pane]: { ...p, selected: [path], anchor: path } } };
      }
      if (mode === "toggle") {
        const has = p.selected.includes(path);
        return {
          panes: {
            ...s.panes,
            [pane]: {
              ...p,
              selected: has
                ? p.selected.filter((x) => x !== path)
                : [...p.selected, path],
              anchor: path,
            },
          },
        };
      }
      // Range: from the anchor to the clicked row in current display order.
      const order = p.entries.map((e) => e.path);
      const from = p.anchor ? order.indexOf(p.anchor) : -1;
      const to = order.indexOf(path);
      if (from < 0 || to < 0) {
        return { panes: { ...s.panes, [pane]: { ...p, selected: [path], anchor: path } } };
      }
      const [lo, hi] = from <= to ? [from, to] : [to, from];
      return {
        panes: { ...s.panes, [pane]: { ...p, selected: order.slice(lo, hi + 1) } },
      };
    });
  },

  clearSelection(pane) {
    set((s) => ({
      panes: { ...s.panes, [pane]: { ...s.panes[pane], selected: [], anchor: null } },
    }));
  },

  setActivePane(pane) {
    set({ activePane: pane });
  },

  openTab(entry, text, truncated) {
    set((s) => {
      const existing = s.tabs.find((t) => t.path === entry.path);
      if (existing) return { activeTab: entry.path };
      return {
        tabs: [
          ...s.tabs,
          {
            path: entry.path,
            name: entry.name,
            original: text,
            draft: text,
            truncated,
            // A truncated buffer must never be written back: saving it would
            // silently discard the tail of the file.
            readonly: entry.isReadonly || truncated,
          },
        ],
        activeTab: entry.path,
      };
    });
  },

  closeTab(path) {
    set((s) => {
      const tabs = s.tabs.filter((t) => t.path !== path);
      const activeTab =
        s.activeTab === path ? (tabs.length ? tabs[tabs.length - 1].path : null) : s.activeTab;
      return { tabs, activeTab };
    });
  },

  setDraft(path, draft) {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.path === path ? { ...t, draft } : t)),
    }));
  },

  markSaved(path) {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.path === path ? { ...t, original: t.draft } : t)),
    }));
  },

  setActiveTab(path) {
    set({ activeTab: path });
  },

  applyView(patch) {
    set((s) =>
      s.settings ? { settings: { ...s.settings, view: { ...s.settings.view, ...patch } } } : s,
    );
    persist(get);
  },

  setSettings(settings) {
    set({ settings: normalizeSettings(settings) });
  },

  async persistSettings() {
    const s = get().settings;
    if (!s) return;
    await saveSettings(s);
  },

  async closeSettings() {
    try {
      await get().persistSettings();
      set({ settingsOpen: false });
    } catch (e) {
      get().toast("error", e instanceof Error ? e.message : String(e));
    }
  },

  toast(kind, text) {
    const id = toastSeq++;
    set((s) => ({ toasts: [...s.toasts, { id, kind, text }] }));
    // Errors stay until dismissed; a failure that vanishes on its own is a
    // failure the user never read.
    if (kind !== "error") {
      setTimeout(() => get().dismissToast(id), 4000);
    }
  },

  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },

  addTerminal(cwd) {
    const id = `term-${termSeq++}`;
    set((s) => ({
      terminals: [...s.terminals, { id, cwd }],
      activeTerminal: id,
    }));
  },

  closeTerminalTab(id) {
    set((s) => {
      const terminals = s.terminals.filter((t) => t.id !== id);
      const activeTerminal =
        s.activeTerminal === id ? (terminals.at(-1)?.id ?? null) : s.activeTerminal;
      return { terminals, activeTerminal };
    });
  },

  closeAllTerminals() {
    set({ terminals: [], activeTerminal: null });
  },

  setActiveTerminal: (activeTerminal) => set({ activeTerminal }),

  setInfoOpen: (infoOpen) => set({ infoOpen }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setAssistantOpen: (assistantOpen) => set({ assistantOpen }),
  setMenuOpen: (menuOpen) => set({ menuOpen }),
}));

export const isDirty = (t: OpenTab) => t.draft !== t.original;

/** Sort a listing for display. Directories always lead, whatever the key. */
export function sortEntries(
  entries: Entry[],
  by: ViewSettings["sortBy"],
  desc: boolean,
): Entry[] {
  const out = [...entries].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
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
  });
  if (!desc) return out;
  // Reverse within each kind so directories keep leading after a descending
  // sort, which is what every file manager does and what users expect.
  const dirs = out.filter((e) => e.kind === "dir").reverse();
  const files = out.filter((e) => e.kind === "file").reverse();
  return [...dirs, ...files];
}
