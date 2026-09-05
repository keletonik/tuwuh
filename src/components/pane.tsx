/**
 * A file pane: breadcrumbs, the listing in one of four view modes, and the
 * interactions that act on the selection.
 *
 * Directory contents come from the backend on every navigation and on every
 * watcher event. Nothing here mutates a cached tree, so a file deleted from a
 * terminal disappears from the pane without the UI having to be told twice.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronRight,
  Eye,
  EyeOff,
  Filter,
  LayoutGrid,
  List,
  Plus,
  RefreshCw,
  Rows3,
  Search,
  TerminalSquare,
  X,
} from "lucide-react";
import {
  compressPaths,
  copyPath,
  createDir,
  createFile,
  createSymlink,
  crumbs,
  deletePermanent,
  duplicatePath,
  extractArchive,
  freeSpace,
  joinPath,
  listDir,
  movePath,
  openPath,
  readTextFile,
  renamePath,
  purgeTrash,
  restoreTrash,
  searchFiles,
  trashPaths,
  type Entry,
  type SearchHit,
  type ViewSettings,
} from "@/lib/api";
import { copyText } from "@/lib/clipboard-text";
import { sortEntries, useApp, type PaneId } from "@/lib/store";
import { formatBytes, formatTime } from "@/lib/utils";
import { FileIcon, categoryLabel } from "./file-icon";
import { ContextMenu, type MenuItem } from "./context-menu";

const VIEW_ICONS: Record<ViewSettings["viewMode"], typeof List> = {
  details: List,
  icons: LayoutGrid,
  compact: Rows3,
  tree: ChevronRight,
};

function uniqueName(cwd: string, existing: string[], base: string): string {
  if (!existing.includes(base)) return joinPath(cwd, base);
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : "";
  for (let n = 2; n < 10_000; n++) {
    const name = `${stem} (${n})${ext}`;
    if (!existing.includes(name)) return joinPath(cwd, name);
  }
  return joinPath(cwd, `${stem}-${Date.now()}${ext}`);
}

export function Pane({ id }: { id: PaneId }) {
  const pane = useApp((s) => s.panes[id]);
  const settings = useApp((s) => s.settings);
  const active = useApp((s) => s.activePane === id);
  const navigate = useApp((s) => s.navigate);
  const refresh = useApp((s) => s.refresh);
  const select = useApp((s) => s.select);
  const setActivePane = useApp((s) => s.setActivePane);
  const openTab = useApp((s) => s.openTab);
  const toast = useApp((s) => s.toast);
  const applyView = useApp((s) => s.applyView);
  const addTerminal = useApp((s) => s.addTerminal);
  const clipboard = useApp((s) => s.clipboard);
  const setClipboard = useApp((s) => s.setClipboard);
  const pushUndo = useApp((s) => s.pushUndo);
  const trashItems = useApp((s) => s.trashItems);
  const editLocation = useApp((s) => s.editLocation === id);
  const editFilter = useApp((s) => s.editFilter === id);
  const otherId: PaneId = id === "a" ? "b" : "a";
  const otherCwd = useApp((s) => s.panes[otherId].cwd);
  const dual = settings?.view.dualPane;

  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("");
  const [locationDraft, setLocationDraft] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; entry: Entry | null } | null>(null);
  const [expanded, setExpanded] = useState<Record<string, Entry[]>>({});
  const [space, setSpace] = useState<{ available: number; total: number } | null>(null);
  const [dropOn, setDropOn] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const locationRef = useRef<HTMLInputElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const typePrefix = useRef("");
  const typeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const view = settings?.view;
  const inTrash = pane.special === "trash";

  const trashEntries: Entry[] = useMemo(
    () =>
      trashItems.map((t) => ({
        path: t.id,
        name: t.name,
        kind: "file" as const,
        size: 0,
        mtime: t.deletedAt > 0 ? t.deletedAt : 0,
        mode: 0,
        isHidden: false,
        isSymlink: false,
        symlinkTarget: t.original,
        isReadonly: true,
        mime: null,
        category: "other" as const,
        childCount: null,
      })),
    [trashItems],
  );

  const rows = useMemo(
    () =>
      view
        ? sortEntries(
            inTrash ? trashEntries : pane.entries,
            view.sortBy,
            view.sortDesc,
            view.foldersFirst !== false,
          )
        : inTrash
          ? trashEntries
          : pane.entries,
    [pane.entries, trashEntries, inTrash, view],
  );

  useEffect(() => {
    if (!query.trim() || inTrash) {
      setHits(null);
      return;
    }
    const t = setTimeout(() => {
      searchFiles(pane.cwd, query.trim(), 300, 6)
        .then(setHits)
        .catch((e) => toast("error", e.message));
    }, 250);
    return () => clearTimeout(t);
  }, [query, pane.cwd, toast, inTrash]);

  useEffect(() => {
    if (editLocation) {
      setLocationDraft(pane.cwd);
      locationRef.current?.focus();
      locationRef.current?.select();
    }
  }, [editLocation, pane.cwd]);

  useEffect(() => {
    if (editFilter) filterRef.current?.focus();
  }, [editFilter]);

  useEffect(() => {
    if (inTrash) return;
    let live = true;
    freeSpace(pane.cwd)
      .then((s) => live && setSpace({ available: s.available, total: s.total }))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [pane.cwd, inTrash]);

  const open = useCallback(
    async (entry: Entry) => {
      if (inTrash) {
        try {
          await restoreTrash([entry.path]);
          await useApp.getState().loadTrash();
          toast("success", `Restored ${entry.name}`);
        } catch (e) {
          toast("error", e instanceof Error ? e.message : String(e));
        }
        return;
      }
      if (entry.kind === "dir") {
        await navigate(id, entry.path);
        return;
      }
      try {
        const file = await readTextFile(entry.path);
        if (file.isUtf8) {
          openTab(entry, file.text, file.truncated);
          if (file.truncated) {
            toast("info", `${entry.name} is larger than the read limit and opened read-only.`);
          }
          return;
        }
        await openPath(entry.path);
      } catch (e) {
        try {
          await openPath(entry.path);
        } catch {
          toast("error", e instanceof Error ? e.message : String(e));
        }
      }
    },
    [id, navigate, openTab, toast, inTrash],
  );

  const commitRename = useCallback(async () => {
    if (!renaming) return;
    const name = renameDraft.trim();
    setRenaming(null);
    if (!name || name === renaming.slice(renaming.lastIndexOf("/") + 1)) return;
    if (name.includes("/")) {
      toast("error", "A name cannot contain a slash.");
      return;
    }
    const to = joinPath(pane.cwd, name);
    try {
      await renamePath(renaming, to);
      pushUndo({ kind: "rename", from: renaming, to });
      await refresh(id);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    }
  }, [renaming, renameDraft, pane.cwd, refresh, id, toast, pushUndo]);

  const doTrash = useCallback(
    async (paths: string[]) => {
      if (!paths.length) return;
      if (settings?.view.confirmDelete) {
        const label = paths.length === 1 ? paths[0].split("/").pop() : `${paths.length} items`;
        if (!window.confirm(`Move ${label} to trash?`)) return;
      }
      try {
        await trashPaths(paths);
        await useApp.getState().loadTrash();
        const ids = useApp
          .getState()
          .trashItems.filter((t) => paths.includes(t.original))
          .map((t) => t.id);
        if (ids.length) pushUndo({ kind: "trash", ids });
        await refresh(id);
        toast("success", `Moved ${paths.length} item${paths.length > 1 ? "s" : ""} to trash.`);
      } catch (e) {
        toast("error", e instanceof Error ? e.message : String(e));
      }
    },
    [settings, refresh, id, toast, pushUndo],
  );

  const doDelete = useCallback(
    async (paths: string[]) => {
      if (!paths.length) return;
      const label = paths.length === 1 ? paths[0].split("/").pop() : `${paths.length} items`;
      if (!window.confirm(`Permanently delete ${label}? This cannot be undone.`)) return;
      try {
        await deletePermanent(paths);
        await refresh(id);
        toast("success", `Deleted ${paths.length} item${paths.length > 1 ? "s" : ""}.`);
      } catch (e) {
        toast("error", e instanceof Error ? e.message : String(e));
      }
    },
    [refresh, id, toast],
  );

  const paste = useCallback(async () => {
    if (inTrash) return;
    if (!clipboard?.paths.length) return;
    try {
      for (const p of clipboard.paths) {
        if (clipboard.cut) await movePath(p, pane.cwd);
        else await copyPath(p, pane.cwd);
      }
      if (clipboard.cut) setClipboard(null);
      await refresh(id);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    }
  }, [clipboard, pane.cwd, refresh, id, toast, setClipboard, inTrash]);

  const createNew = useCallback(
    async (kind: "file" | "dir") => {
      const existing = pane.entries.map((e) => e.name);
      const dest = uniqueName(pane.cwd, existing, kind === "dir" ? "New Folder" : "untitled.txt");
      try {
        if (kind === "dir") await createDir(dest);
        else await createFile(dest);
        pushUndo({ kind: "create", path: dest });
        await refresh(id);
        setRenaming(dest);
        setRenameDraft(dest.slice(dest.lastIndexOf("/") + 1));
      } catch (e) {
        toast("error", e instanceof Error ? e.message : String(e));
      }
    },
    [pane.cwd, pane.entries, refresh, id, toast, pushUndo],
  );

  const dropPaths = useCallback(
    async (paths: string[], destDir: string, copy: boolean) => {
      if (!paths.length) return;
      try {
        for (const p of paths) {
          if (copy) await copyPath(p, destDir);
          else await movePath(p, destDir);
        }
        await refresh(id);
      } catch (e) {
        toast("error", e instanceof Error ? e.message : String(e));
      }
    },
    [refresh, id, toast],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (renaming) return;
      const visible = hits ? hits.map((h) => h.entry) : rows;
      const filtered = filter
        ? visible.filter((r) => r.name.toLowerCase().includes(filter.toLowerCase()))
        : visible;
      const order = filtered.map((r) => r.path);
      const current = pane.selected[pane.selected.length - 1];
      const index = current ? order.indexOf(current) : -1;
      const accel = e.ctrlKey || e.metaKey;

      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const next = e.key === "ArrowDown" ? index + 1 : index - 1;
        const target = order[Math.max(0, Math.min(order.length - 1, next))];
        if (target) select(id, target, e.shiftKey ? "range" : "set", order);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const entry = filtered.find((r) => r.path === current);
        if (entry) void open(entry);
        return;
      }
      if (e.key === "Backspace" && !accel) {
        e.preventDefault();
        void useApp.getState().goUp(id);
        return;
      }
      if (e.key === "Delete") {
        e.preventDefault();
        if (inTrash) {
          if (!pane.selected.length) return;
          if (!window.confirm("Permanently delete these trash items?")) return;
          void purgeTrash(pane.selected)
            .then(() => useApp.getState().loadTrash())
            .catch((err) => toast("error", err instanceof Error ? err.message : String(err)));
          return;
        }
        if (e.shiftKey) void doDelete(pane.selected);
        else void doTrash(pane.selected);
        return;
      }
      if (accel && e.key === "a") {
        e.preventDefault();
        useApp.getState().selectAll(id, order);
        return;
      }
      if (accel && e.shiftKey && e.key.toLowerCase() === "a") {
        e.preventDefault();
        useApp.getState().invertSelection(id, order);
        return;
      }
      if (inTrash) return;
      if (e.key === "F2" && current) {
        e.preventDefault();
        setRenaming(current);
        setRenameDraft(current.slice(current.lastIndexOf("/") + 1));
        return;
      }
      if (e.key === "F10") {
        e.preventDefault();
        void createNew("dir");
        return;
      }
      if (accel && (e.key === "c" || e.key === "x")) {
        e.preventDefault();
        setClipboard({ paths: [...pane.selected], cut: e.key === "x" });
        return;
      }
      if (accel && e.key === "v") {
        e.preventDefault();
        void paste();
        return;
      }
      if (accel && e.key === "l") {
        e.preventDefault();
        useApp.getState().setEditLocation(id);
        return;
      }
      if (accel && e.key === "i") {
        e.preventDefault();
        useApp.getState().setEditFilter(id);
        return;
      }
      if (accel && e.key === "f") {
        e.preventDefault();
        const el = listRef.current?.parentElement?.querySelector("input[aria-label='Search in this directory']");
        if (el instanceof HTMLInputElement) el.focus();
        return;
      }
      if (!accel && !e.altKey && e.key.length === 1 && !e.repeat) {
        if (typeTimer.current) clearTimeout(typeTimer.current);
        typePrefix.current += e.key;
        typeTimer.current = setTimeout(() => {
          typePrefix.current = "";
        }, 800);
        const needle = typePrefix.current.toLowerCase();
        const hit = filtered.find((r) => r.name.toLowerCase().startsWith(needle));
        if (hit) select(id, hit.path, "set", order);
      }
    },
    [renaming, rows, hits, filter, pane.selected, select, id, open, doTrash, doDelete, paste, setClipboard, createNew, inTrash, toast],
  );

  const menuItems = useCallback(
    (entry: Entry | null): MenuItem[] => {
      if (inTrash) {
        const targets = entry
          ? pane.selected.includes(entry.path)
            ? pane.selected
            : [entry.path]
          : pane.selected;
        return [
          {
            label: "Restore",
            disabled: targets.length === 0,
            onSelect: () =>
              void restoreTrash(targets)
                .then(() => useApp.getState().loadTrash())
                .then(() => toast("success", "Restored."))
                .catch((e) => toast("error", e.message)),
          },
          {
            label: "Delete permanently",
            danger: true,
            disabled: targets.length === 0,
            onSelect: () => {
              if (!window.confirm("Permanently delete these trash items?")) return;
              void purgeTrash(targets)
                .then(() => useApp.getState().loadTrash())
                .catch((e) => toast("error", e.message));
            },
          },
          { label: "Refresh", onSelect: () => void refresh(id) },
        ];
      }
      const targets = entry
        ? pane.selected.includes(entry.path)
          ? pane.selected
          : [entry.path]
        : [];
      const dest = entry?.kind === "dir" ? entry.path : pane.cwd;
      return [
        ...(entry
          ? [
              { label: "Open", onSelect: () => void open(entry) },
              {
                label: "Open with default application",
                onSelect: () => void openPath(entry.path).catch((e) => toast("error", e.message)),
              },
              ...(entry.kind === "dir"
                ? [
                    {
                      label: "Open in new tab",
                      onSelect: () => void useApp.getState().openFolderTab(id, entry.path),
                    },
                    ...(dual
                      ? [
                          {
                            label: "Open in other pane",
                            onSelect: () => void navigate(otherId, entry.path),
                          },
                        ]
                      : []),
                  ]
                : [
                    {
                      label: "Open in editor",
                      onSelect: () =>
                        void readTextFile(entry.path).then((f) =>
                          openTab(entry, f.text, f.truncated),
                        ),
                    },
                  ]),
              { separator: true as const },
              {
                label: "Rename",
                shortcut: "F2",
                onSelect: () => {
                  setRenaming(entry.path);
                  setRenameDraft(entry.name);
                },
              },
              {
                label: "Duplicate",
                onSelect: () =>
                  void duplicatePath(entry.path)
                    .then(() => refresh(id))
                    .catch((e) => toast("error", e.message)),
              },
              {
                label: "Create link here",
                onSelect: () => {
                  const link = uniqueName(pane.cwd, pane.entries.map((e) => e.name), `Link to ${entry.name}`);
                  void createSymlink(entry.path, link)
                    .then(() => refresh(id))
                    .catch((e) => toast("error", e.message));
                },
              },
              {
                label: "Copy",
                shortcut: "Ctrl C",
                onSelect: () => setClipboard({ paths: targets, cut: false }),
              },
              {
                label: "Cut",
                shortcut: "Ctrl X",
                onSelect: () => setClipboard({ paths: targets, cut: true }),
              },
              {
                label: "Copy location",
                onSelect: () =>
                  void copyText(entry.path).then(() => toast("success", "Path copied.")),
              },
              ...(dual
                ? [
                    {
                      label: "Copy to other pane",
                      onSelect: () =>
                        void dropPaths(targets, otherCwd, true),
                    },
                    {
                      label: "Move to other pane",
                      onSelect: () => void dropPaths(targets, otherCwd, false),
                    },
                  ]
                : []),
              {
                label: "Compress…",
                onSelect: () => {
                  const first = targets[0]?.split("/").pop() ?? "archive";
                  const dest = joinPath(pane.cwd, `${first}.tar.gz`);
                  void compressPaths(targets, dest)
                    .then((p) => {
                      toast("success", `Wrote ${p.split("/").pop()}`);
                      return refresh(id);
                    })
                    .catch((e) => toast("error", e.message));
                },
              },
              ...(entry.category === "archive"
                ? [
                    {
                      label: "Extract here",
                      onSelect: () =>
                        void extractArchive(entry.path, pane.cwd)
                          .then(() => refresh(id))
                          .catch((e) => toast("error", e.message)),
                    },
                  ]
                : []),
              { separator: true as const },
              {
                label: "Move to trash",
                shortcut: "Del",
                danger: true,
                onSelect: () => void doTrash(targets),
              },
              {
                label: "Delete permanently",
                shortcut: "Shift Del",
                danger: true,
                onSelect: () => void doDelete(targets),
              },
              {
                label: "Properties",
                shortcut: "Alt Enter",
                onSelect: () => useApp.getState().setPropertiesPath(entry.path),
              },
              { separator: true as const },
            ]
          : []),
        {
          label: "Paste",
          shortcut: "Ctrl V",
          disabled: !clipboard?.paths.length,
          onSelect: () => void paste(),
        },
        { label: "New folder", shortcut: "F10", onSelect: () => void createNew("dir") },
        { label: "New file", onSelect: () => void createNew("file") },
        { label: "Refresh", onSelect: () => void refresh(id) },
        {
          label: "Open terminal here",
          onSelect: () => addTerminal(dest),
        },
        {
          label: "Properties",
          onSelect: () => useApp.getState().setPropertiesPath(pane.cwd),
        },
      ];
    },
    [
      pane.selected,
      pane.cwd,
      pane.entries,
      clipboard,
      open,
      doTrash,
      doDelete,
      paste,
      refresh,
      id,
      addTerminal,
      setClipboard,
      toast,
      dual,
      otherCwd,
      otherId,
      navigate,
      openTab,
      dropPaths,
      createNew,
      inTrash,
    ],
  );

  if (!view) return null;

  const visible: Entry[] = hits ? hits.map((h) => h.entry) : rows;
  const shown = filter
    ? visible.filter((e) => e.name.toLowerCase().includes(filter.toLowerCase()))
    : visible;

  const flattenTree = (
    entries: Entry[],
    depth: number,
  ): { entry: Entry; depth: number }[] => {
    const out: { entry: Entry; depth: number }[] = [];
    for (const entry of entries) {
      out.push({ entry, depth });
      if (entry.kind === "dir" && expanded[entry.path]) {
        out.push(...flattenTree(expanded[entry.path], depth + 1));
      }
    }
    return out;
  };

  const treeRows: { entry: Entry; depth: number }[] =
    view.viewMode === "tree" && !hits && !inTrash
      ? flattenTree(shown, 0)
      : shown.map((entry) => ({ entry, depth: 0 }));

  const toggleExpand = async (entry: Entry) => {
    if (entry.kind !== "dir") return;
    if (expanded[entry.path]) {
      setExpanded((s) => {
        const next = { ...s };
        delete next[entry.path];
        return next;
      });
      return;
    }
    try {
      const kids = await listDir(entry.path, view.showHidden);
      setExpanded((s) => ({ ...s, [entry.path]: kids }));
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section
      className="fm-pane"
      data-active={active || undefined}
      data-trash={inTrash || undefined}
      onMouseDown={() => setActivePane(id)}
      onKeyDown={onKeyDown}
      tabIndex={0}
    >
      <header className="fm-pane-bar">
        <div className="fm-nav">
          <button type="button" aria-label="Back" onClick={() => void useApp.getState().goBack(id)}
            disabled={pane.historyIndex <= 0}>
            <ArrowLeft size={15} />
          </button>
          <button type="button" aria-label="Forward" onClick={() => void useApp.getState().goForward(id)}
            disabled={pane.historyIndex >= pane.history.length - 1}>
            <ArrowRight size={15} />
          </button>
          <button type="button" aria-label="Up" onClick={() => void useApp.getState().goUp(id)}
            disabled={pane.cwd === "/" && !inTrash}>
            <ArrowUp size={15} />
          </button>
          <button type="button" aria-label="Refresh" onClick={() => void refresh(id)}>
            <RefreshCw size={15} />
          </button>
        </div>

        {editLocation ? (
          <form
            className="fm-location"
            data-no-drag
            onSubmit={(e) => {
              e.preventDefault();
              const path = locationDraft.trim() || pane.cwd;
              useApp.getState().setEditLocation(null);
              void navigate(id, path.startsWith("/") ? path : joinPath(pane.cwd, path));
            }}
          >
            <input
              ref={locationRef}
              value={locationDraft}
              onChange={(e) => setLocationDraft(e.target.value)}
              onBlur={() => useApp.getState().setEditLocation(null)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  useApp.getState().setEditLocation(null);
                }
                e.stopPropagation();
              }}
              aria-label="Location"
            />
          </form>
        ) : (
          <nav
            className="fm-crumbs"
            aria-label="Breadcrumb"
            onClick={() => useApp.getState().setEditLocation(id)}
          >
            {inTrash ? (
              <span>
                <button type="button">Trash</button>
              </span>
            ) : (
              crumbs(pane.cwd).map((c, i, all) => (
                <span key={c.path}>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void navigate(id, c.path);
                    }}
                  >
                    {c.label}
                  </button>
                  {i < all.length - 1 && <ChevronRight size={12} className="fm-crumb-sep" />}
                </span>
              ))
            )}
          </nav>
        )}

        <div className="fm-pane-tools">
          <label className="fm-search">
            <Search size={14} />
            <input
              value={query}
              placeholder="Search here"
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search in this directory"
              disabled={inTrash}
            />
          </label>

          <button
            type="button"
            aria-label={view.showHidden ? "Hide hidden files" : "Show hidden files"}
            title={view.showHidden ? "Hide hidden files" : "Show hidden files"}
            onClick={() => applyView({ showHidden: !view.showHidden })}
          >
            {view.showHidden ? <Eye size={15} /> : <EyeOff size={15} />}
          </button>

          {(["details", "icons", "compact", "tree"] as const).map((mode) => {
            const Icon = VIEW_ICONS[mode];
            return (
              <button
                key={mode}
                type="button"
                aria-label={`${mode} view`}
                aria-pressed={view.viewMode === mode}
                data-on={view.viewMode === mode || undefined}
                onClick={() => applyView({ viewMode: mode })}
              >
                <Icon size={15} />
              </button>
            );
          })}

          <button
            type="button"
            aria-label="New tab"
            title="New tab"
            onClick={() => void useApp.getState().openFolderTab(id, pane.cwd)}
          >
            <Plus size={15} />
          </button>

          <button
            type="button"
            aria-label="Open terminal here"
            onClick={() => addTerminal(pane.cwd)}
          >
            <TerminalSquare size={15} />
          </button>
        </div>
      </header>

      {pane.tabs.length > 1 && (
        <div className="fm-folder-tabs" data-no-drag>
          {pane.tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              data-on={t.id === pane.activeTabId || undefined}
              onClick={() => void useApp.getState().activateFolderTab(id, t.id)}
              onAuxClick={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  void useApp.getState().closeFolderTab(id, t.id);
                }
              }}
            >
              <span>{t.path === "/" ? "/" : t.path.split("/").pop()}</span>
              <span
                className="fm-tab-x"
                role="button"
                aria-label="Close tab"
                onClick={(e) => {
                  e.stopPropagation();
                  void useApp.getState().closeFolderTab(id, t.id);
                }}
              >
                <X size={11} />
              </span>
            </button>
          ))}
        </div>
      )}

      {(editFilter || filter) && (
        <label className="fm-filter" data-no-drag>
          <Filter size={14} />
          <input
            ref={filterRef}
            value={filter}
            placeholder="Filter this folder"
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setFilter("");
                useApp.getState().setEditFilter(null);
              }
              e.stopPropagation();
            }}
            aria-label="Filter this folder"
          />
        </label>
      )}

      <div
        className="fm-list"
        data-view={view.viewMode}
        style={
          view.viewMode === "icons"
            ? ({
                "--fm-icon-cell": `${Math.max(88, (view.iconSize || 34) + 74)}px`,
                "--fm-icon-row": `${Math.max(80, (view.iconSize || 34) + 62)}px`,
              } as CSSProperties)
            : undefined
        }
        ref={listRef}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY, entry: null });
        }}
        onMouseDown={(e) => {
          if (e.target === listRef.current) useApp.getState().clearSelection(id);
        }}
        onDragOver={(e) => {
          if (inTrash) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = e.ctrlKey ? "copy" : "move";
        }}
        onDrop={(e) => {
          if (inTrash) return;
          e.preventDefault();
          setDropOn(null);
          const raw = e.dataTransfer.getData("application/tuwuh-paths");
          if (!raw) return;
          try {
            const paths = JSON.parse(raw) as string[];
            void dropPaths(paths, pane.cwd, e.ctrlKey || e.dataTransfer.dropEffect === "copy");
          } catch {
            /* ignore */
          }
        }}
      >
        {pane.error && <p className="fm-error">{pane.error}</p>}
        {!pane.error && pane.loading && <p className="fm-muted-line">Reading {pane.cwd}…</p>}
        {!pane.error && !pane.loading && shown.length === 0 && (
          <p className="fm-muted-line">{hits ? "Nothing matched." : inTrash ? "Trash is empty." : "This folder is empty."}</p>
        )}

        {view.viewMode === "details" && shown.length > 0 && (
          <div className="fm-row fm-head" role="row">
            {(["name", "size", "mtime", "category"] as const).map((key) => (
              <button
                key={key}
                type="button"
                className={`fm-col fm-col-${key}`}
                onClick={() =>
                  applyView({
                    sortBy: key,
                    sortDesc: view.sortBy === key ? !view.sortDesc : false,
                  })
                }
              >
                {key === "mtime" ? "Modified" : key[0].toUpperCase() + key.slice(1)}
                {view.sortBy === key && <span aria-hidden>{view.sortDesc ? " ▾" : " ▴"}</span>}
              </button>
            ))}
          </div>
        )}

        {treeRows.map(({ entry, depth }) => {
          const isSelected = pane.selected.includes(entry.path);
          const isOpen = Boolean(expanded[entry.path]);
          return (
            <div
              key={entry.path}
              className="fm-row"
              role="row"
              draggable={!inTrash && !renaming}
              data-selected={isSelected || undefined}
              data-hidden={entry.isHidden || undefined}
              data-drop={dropOn === entry.path || undefined}
              style={depth ? { paddingLeft: 6 + depth * 16 } : undefined}
              onDragStart={(e) => {
                const paths = isSelected ? pane.selected : [entry.path];
                e.dataTransfer.setData("application/tuwuh-paths", JSON.stringify(paths));
                e.dataTransfer.effectAllowed = "copyMove";
              }}
              onDragOver={(e) => {
                if (entry.kind !== "dir") return;
                e.preventDefault();
                e.stopPropagation();
                setDropOn(entry.path);
              }}
              onDragLeave={() => setDropOn((s) => (s === entry.path ? null : s))}
              onDrop={(e) => {
                if (entry.kind !== "dir") return;
                e.preventDefault();
                e.stopPropagation();
                setDropOn(null);
                const raw = e.dataTransfer.getData("application/tuwuh-paths");
                if (!raw) return;
                try {
                  const paths = (JSON.parse(raw) as string[]).filter((p) => p !== entry.path);
                  void dropPaths(paths, entry.path, e.ctrlKey);
                } catch {
                  /* ignore */
                }
              }}
              onMouseDown={(e) => {
                e.stopPropagation();
                select(
                  id,
                  entry.path,
                  e.shiftKey ? "range" : e.ctrlKey || e.metaKey ? "toggle" : "set",
                  shown.map((row) => row.path),
                );
              }}
              onDoubleClick={() => void open(entry)}
              onClick={(e) => {
                if (settings?.view.singleClickOpen && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
                  void open(entry);
                }
              }}
              onAuxClick={(e) => {
                if (e.button === 1 && entry.kind === "dir") {
                  e.preventDefault();
                  void useApp.getState().openFolderTab(id, entry.path);
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (!isSelected) select(id, entry.path, "set");
                setMenu({ x: e.clientX, y: e.clientY, entry });
              }}
              title={
                inTrash
                  ? entry.symlinkTarget ?? entry.name
                  : entry.symlinkTarget
                    ? `${entry.name} → ${entry.symlinkTarget}`
                    : entry.name
              }
            >
              <span className="fm-col fm-col-name">
                {view.viewMode === "tree" && entry.kind === "dir" && (
                  <button
                    type="button"
                    className="fm-twist"
                    aria-label={isOpen ? "Collapse" : "Expand"}
                    onClick={(e) => {
                      e.stopPropagation();
                      void toggleExpand(entry);
                    }}
                  >
                    <ChevronRight size={12} style={{ transform: isOpen ? "rotate(90deg)" : undefined }} />
                  </button>
                )}
                <FileIcon
                  entry={entry}
                  size={view.viewMode === "icons" ? view.iconSize || 34 : 16}
                  open={isOpen}
                />
                {renaming === entry.path ? (
                  <input
                    className="fm-rename"
                    autoFocus
                    value={renameDraft}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onBlur={() => void commitRename()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void commitRename();
                      if (e.key === "Escape") setRenaming(null);
                      e.stopPropagation();
                    }}
                  />
                ) : (
                  <span className="fm-name">{entry.name}</span>
                )}
              </span>
              {view.viewMode === "details" && (
                <>
                  <span className="fm-col fm-col-size">
                    {entry.kind === "dir" ? "—" : formatBytes(entry.size)}
                  </span>
                  <span className="fm-col fm-col-mtime">{formatTime(entry.mtime)}</span>
                  <span className="fm-col fm-col-category">
                    {inTrash ? "Trash" : categoryLabel[entry.category]}
                  </span>
                </>
              )}
            </div>
          );
        })}
      </div>

      <footer className="fm-status">
        <span>
          {shown.length} item{shown.length === 1 ? "" : "s"}
          {pane.selected.length > 0 && `, ${pane.selected.length} selected`}
        </span>
        {clipboard && (
          <span className="fm-clip">
            {clipboard.cut ? "Cut" : "Copied"} {clipboard.paths.length}
          </span>
        )}
        {space && !inTrash && (
          <span className="fm-free" title={`${formatBytes(space.available)} free of ${formatBytes(space.total)}`}>
            {formatBytes(space.available)} free
          </span>
        )}
      </footer>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems(menu.entry)}
          onClose={() => setMenu(null)}
        />
      )}
    </section>
  );
}
