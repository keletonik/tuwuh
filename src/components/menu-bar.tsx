/**
 * Application menu, shown when Alt is pressed.
 *
 * File managers of this kind are keyboard-driven. The chrome icons stay for
 * pointer use; Alt reveals named menus so View, Go and File are reachable
 * without hunting for a 15px glyph.
 */
import { useEffect } from "react";
import { newWindow } from "@/lib/api";
import { parseTerminalDock, TERMINAL_DOCKS } from "@/lib/layout";
import { useApp, type PaneId } from "@/lib/store";
import { windowClose } from "@/lib/window";

interface Item {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  action?: () => void;
}

function Menu({ title, items }: { title: string; items: Item[] }) {
  return (
    <div className="fm-menu">
      <button type="button" className="fm-menu-title">
        {title}
      </button>
      <div className="fm-menu-drop" role="menu">
        {items.map((it, i) =>
          it.label === "-" ? (
            <hr key={`s${i}`} />
          ) : (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              disabled={it.disabled}
              data-danger={it.danger || undefined}
              onClick={() => it.action?.()}
            >
              <span>{it.label}</span>
              {it.shortcut && <kbd>{it.shortcut}</kbd>}
            </button>
          ),
        )}
      </div>
    </div>
  );
}

export function MenuBar() {
  const visible = useApp((s) => s.menuOpen);
  const setMenuOpen = useApp((s) => s.setMenuOpen);
  const settings = useApp((s) => s.settings);
  const pane = useApp((s) => s.activePane);
  const active = useApp((s) => s.panes[s.activePane]);
  const applyView = useApp((s) => s.applyView);
  const addTerminal = useApp((s) => s.addTerminal);
  const closeAllTerminals = useApp((s) => s.closeAllTerminals);
  const terminals = useApp((s) => s.terminals);

  useEffect(() => {
    let chord = false;
    const onDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.key === "Alt") {
        chord = false;
        return;
      }
      if (e.altKey) chord = true;
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.key !== "Alt") return;
      if (!chord && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        setMenuOpen(!useApp.getState().menuOpen);
      }
      chord = false;
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
  }, [setMenuOpen]);

  if (!visible || !settings) return null;
  const view = settings.view;
  const dock = parseTerminalDock(view.terminalDock);
  const go = (fn: (p: PaneId) => void) => () => fn(pane);

  return (
    <nav className="fm-menubar" aria-label="Application">
      <Menu
        title="File"
        items={[
          {
            label: "New window",
            shortcut: "Ctrl N",
            action: () => void newWindow().catch((e) => useApp.getState().toast("error", e.message)),
          },
          {
            label: "New tab",
            action: () => void useApp.getState().openFolderTab(pane, active.cwd),
          },
          { label: "-" },
          {
            label: "Settings",
            shortcut: "Ctrl ,",
            action: () => useApp.getState().setSettingsOpen(true),
          },
          {
            label: "Properties",
            shortcut: "Alt Enter",
            action: () =>
              useApp.getState().setPropertiesPath(active.selected.at(-1) ?? active.cwd),
          },
          { label: "-" },
          {
            label: "Close editor tab",
            disabled: !useApp.getState().activeTab,
            action: () => {
              const t = useApp.getState().activeTab;
              if (t) useApp.getState().closeTab(t);
            },
          },
          {
            label: "Quit",
            shortcut: "Ctrl Q",
            action: () => void windowClose(),
          },
        ]}
      />
      <Menu
        title="View"
        items={[
          {
            label: "Details",
            action: () => applyView({ viewMode: "details" }),
          },
          { label: "Icons", action: () => applyView({ viewMode: "icons" }) },
          { label: "Compact", action: () => applyView({ viewMode: "compact" }) },
          { label: "Tree", action: () => applyView({ viewMode: "tree" }) },
          { label: "-" },
          {
            label: view.dualPane ? "Single pane" : "Dual pane",
            shortcut: "F3",
            action: () => applyView({ dualPane: !view.dualPane }),
          },
          {
            label: view.showHidden ? "Hide hidden files" : "Show hidden files",
            action: () => applyView({ showHidden: !view.showHidden }),
          },
          {
            label: "Information panel",
            action: () => useApp.getState().setInfoOpen(!useApp.getState().infoOpen),
          },
          {
            label: "Assistant",
            action: () => useApp.getState().setAssistantOpen(!useApp.getState().assistantOpen),
          },
        ]}
      />
      <Menu
        title="Go"
        items={[
          { label: "Back", shortcut: "Alt Left", action: go((p) => void useApp.getState().goBack(p)) },
          { label: "Forward", shortcut: "Alt Right", action: go((p) => void useApp.getState().goForward(p)) },
          {
            label: "Up",
            shortcut: "Backspace",
            disabled: active.cwd === "/",
            action: go((p) => void useApp.getState().goUp(p)),
          },
          { label: "-" },
          {
            label: "Home",
            action: () => void useApp.getState().navigate(pane, useApp.getState().home),
          },
          {
            label: "Trash",
            action: () => void useApp.getState().openTrash(pane),
          },
          {
            label: "Location bar",
            shortcut: "Ctrl L",
            action: () => useApp.getState().setEditLocation(pane),
          },
        ]}
      />
      <Menu
        title="Terminal"
        items={[
          {
            label: "New terminal",
            shortcut: "F4",
            action: () => addTerminal(active.cwd),
          },
          {
            label: "Close terminals",
            disabled: terminals.length === 0,
            action: () => closeAllTerminals(),
          },
          { label: "-" },
          ...TERMINAL_DOCKS.map((d) => ({
            label: `Dock ${d}${dock === d ? " (on)" : ""}`,
            action: () => applyView({ terminalDock: d }),
          })),
        ]}
      />
    </nav>
  );
}
