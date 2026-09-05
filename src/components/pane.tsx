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
  LayoutGrid,
  List,
  RefreshCw,
  Rows3,
  Search,
  TerminalSquare,
} from "lucide-react";
import {
  copyPath,
  crumbs,
  joinPath,
  movePath,
  readTextFile,
  renamePath,
  searchFiles,
  trashPaths,
  type Entry,
  type SearchHit,
  type ViewSettings,
} from "@/lib/api";
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

  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; entry: Entry | null } | null>(null);
  const [clipboard, setClipboard] = useState<{ paths: string[]; cut: boolean } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const view = settings?.view;
  const rows = useMemo(
    () =>
      view
        ? sortEntries(pane.entries, view.sortBy, view.sortDesc, view.foldersFirst !== false)
        : pane.entries,
    [pane.entries, view],
  );

  /* Search is debounced and scoped to the current directory. An empty query
     drops back to the plain listing rather than showing zero results. */
  useEffect(() => {
    if (!query.trim()) {
      setHits(null);
      return;
    }
    const t = setTimeout(() => {
      searchFiles(pane.cwd, query.trim(), 300, 6)
        .then(setHits)
        .catch((e) => toast("error", e.message));
    }, 250);
    return () => clearTimeout(t);
  }, [query, pane.cwd, toast]);

  const open = useCallback(
    async (entry: Entry) => {
      if (entry.kind === "dir") {
        await navigate(id, entry.path);
        return;
      }
      try {
        const file = await readTextFile(entry.path);
        if (!file.isUtf8) {
          toast("info", `${entry.name} is not text. Preview it from the info panel.`);
          return;
        }
        openTab(entry, file.text, file.truncated);
        if (file.truncated) {
          toast(
            "info",
            `${entry.name} is larger than the read limit and opened read-only.`,
          );
        }
      } catch (e) {
        toast("error", e instanceof Error ? e.message : String(e));
      }
    },
    [id, navigate, openTab, toast],
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
    try {
      await renamePath(renaming, joinPath(pane.cwd, name));
      await refresh(id);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    }
  }, [renaming, renameDraft, pane.cwd, refresh, id, toast]);

  const doTrash = useCallback(
    async (paths: string[]) => {
      if (!paths.length) return;
      if (settings?.view.confirmDelete) {
        const label = paths.length === 1 ? paths[0].split("/").pop() : `${paths.length} items`;
        if (!window.confirm(`Move ${label} to trash?`)) return;
      }
      try {
        await trashPaths(paths);
        await refresh(id);
        toast("success", `Moved ${paths.length} item${paths.length > 1 ? "s" : ""} to trash.`);
      } catch (e) {
        toast("error", e instanceof Error ? e.message : String(e));
      }
    },
    [settings, refresh, id, toast],
  );

  const paste = useCallback(async () => {
    if (!clipboard?.paths.length) return;
    try {
      for (const p of clipboard.paths) {
        if (clipboard.cut) await movePath(p, pane.cwd);
        else await copyPath(p, pane.cwd);
      }
      // A cut is consumed by the paste; a copy stays on the clipboard so it can
      // be pasted into several places.
      if (clipboard.cut) setClipboard(null);
      await refresh(id);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    }
  }, [clipboard, pane.cwd, refresh, id, toast]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (renaming) return;
      const visible = hits ? hits.map((h) => h.entry) : rows;
      const order = visible.map((r) => r.path);
      const current = pane.selected[pane.selected.length - 1];
      const index = current ? order.indexOf(current) : -1;

      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const next = e.key === "ArrowDown" ? index + 1 : index - 1;
        const target = order[Math.max(0, Math.min(order.length - 1, next))];
        if (target) select(id, target, e.shiftKey ? "range" : "set");
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const entry = rows.find((r) => r.path === current);
        if (entry) void open(entry);
        return;
      }
      if (e.key === "Backspace") {
        e.preventDefault();
        void useApp.getState().goUp(id);
        return;
      }
      if (e.key === "Delete") {
        e.preventDefault();
        void doTrash(pane.selected);
        return;
      }
      if (e.key === "F2" && current) {
        e.preventDefault();
        setRenaming(current);
        setRenameDraft(current.slice(current.lastIndexOf("/") + 1));
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "a") {
        e.preventDefault();
        useApp.getState().selectAll(id, order);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "c" || e.key === "x")) {
        e.preventDefault();
        setClipboard({ paths: [...pane.selected], cut: e.key === "x" });
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "v") {
        e.preventDefault();
        void paste();
      }
    },
    [renaming, rows, hits, pane.selected, select, id, open, doTrash, paste],
  );

  const menuItems = useCallback(
    (entry: Entry | null): MenuItem[] => {
      const targets = entry
        ? pane.selected.includes(entry.path)
          ? pane.selected
          : [entry.path]
        : [];
      return [
        ...(entry
          ? [
              { label: "Open", onSelect: () => void open(entry) },
              {
                label: "Rename",
                shortcut: "F2",
                onSelect: () => {
                  setRenaming(entry.path);
                  setRenameDraft(entry.name);
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
              { separator: true as const },
              {
                label: "Move to trash",
                shortcut: "Del",
                danger: true,
                onSelect: () => void doTrash(targets),
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
        { label: "Refresh", onSelect: () => void refresh(id) },
        {
          label: "Open terminal here",
          onSelect: () => addTerminal(pane.cwd),
        },
      ];
    },
    [pane.selected, pane.cwd, clipboard, open, doTrash, paste, refresh, id, addTerminal],
  );

  if (!view) return null;
  const shown: Entry[] = hits ? hits.map((h) => h.entry) : rows;

  return (
    <section
      className="fm-pane"
      data-active={active || undefined}
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
            disabled={pane.cwd === "/"}>
            <ArrowUp size={15} />
          </button>
          <button type="button" aria-label="Refresh" onClick={() => void refresh(id)}>
            <RefreshCw size={15} />
          </button>
        </div>

        <nav className="fm-crumbs" aria-label="Breadcrumb">
          {crumbs(pane.cwd).map((c, i, all) => (
            <span key={c.path}>
              <button type="button" onClick={() => void navigate(id, c.path)}>
                {c.label}
              </button>
              {i < all.length - 1 && <ChevronRight size={12} className="fm-crumb-sep" />}
            </span>
          ))}
        </nav>

        <div className="fm-pane-tools">
          <label className="fm-search">
            <Search size={14} />
            <input
              value={query}
              placeholder="Search here"
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search in this directory"
            />
          </label>

          <button
            type="button"
            aria-label={view.showHidden ? "Hide hidden files" : "Show hidden files"}
            title={view.showHidden ? "Hide hidden files" : "Show hidden files"}
            onClick={() => {
              applyView({ showHidden: !view.showHidden });
              void refresh(id);
            }}
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
            aria-label="Open terminal here"
            onClick={() => addTerminal(pane.cwd)}
          >
            <TerminalSquare size={15} />
          </button>
        </div>
      </header>

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
          // A click on empty space clears the selection, the same as Dolphin.
          if (e.target === listRef.current) useApp.getState().clearSelection(id);
        }}
      >
        {pane.error && <p className="fm-error">{pane.error}</p>}
        {!pane.error && pane.loading && <p className="fm-muted-line">Reading {pane.cwd}…</p>}
        {!pane.error && !pane.loading && shown.length === 0 && (
          <p className="fm-muted-line">{hits ? "Nothing matched." : "This folder is empty."}</p>
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

        {shown.map((entry) => {
          const isSelected = pane.selected.includes(entry.path);
          return (
            <div
              key={entry.path}
              className="fm-row"
              role="row"
              data-selected={isSelected || undefined}
              data-hidden={entry.isHidden || undefined}
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
              onClick={() => {
                if (settings?.view.singleClickOpen) void open(entry);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (!isSelected) select(id, entry.path, "set");
                setMenu({ x: e.clientX, y: e.clientY, entry });
              }}
              title={entry.symlinkTarget ? `${entry.name} → ${entry.symlinkTarget}` : entry.name}
            >
              <span className="fm-col fm-col-name">
                <FileIcon
                  entry={entry}
                  size={view.viewMode === "icons" ? view.iconSize || 34 : 16}
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
                  <span className="fm-col fm-col-category">{categoryLabel[entry.category]}</span>
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
