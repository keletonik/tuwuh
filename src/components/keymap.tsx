/**
 * Global shortcuts that the menu advertises. Bound here so the labels in the
 * Alt bar are not decoration.
 *
 * Ctrl+, and Ctrl+Q stay active in fields. Alt+Left/Right are skipped inside
 * inputs and the terminal, where those chords already mean something.
 */
import { useEffect } from "react";
import { newWindow, restoreTrash, renamePath, trashPaths } from "@/lib/api";
import { useApp } from "@/lib/store";
import { windowClose } from "@/lib/window";

function inEditable(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  if (t.closest(".xterm")) return true;
  const tag = t.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return Boolean(t.closest("[contenteditable='true']"));
}

export function Keymap() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const accel = e.ctrlKey || e.metaKey;
      const s = useApp.getState();

      if (accel && e.key === ",") {
        e.preventDefault();
        s.setSettingsOpen(true);
        return;
      }
      if (accel && e.key.toLowerCase() === "q") {
        e.preventDefault();
        void windowClose();
        return;
      }
      if (e.key === "Escape") {
        if (s.settingsOpen) {
          e.preventDefault();
          void s.closeSettings();
          return;
        }
        if (s.propertiesPath) {
          e.preventDefault();
          s.setPropertiesPath(null);
          return;
        }
        if (s.editLocation || s.editFilter) {
          e.preventDefault();
          s.setEditLocation(null);
          s.setEditFilter(null);
          return;
        }
        if (s.menuOpen) {
          e.preventDefault();
          s.setMenuOpen(false);
        }
        return;
      }
      if (accel && e.key.toLowerCase() === "n" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        void newWindow().catch((err) => s.toast("error", err instanceof Error ? err.message : String(err)));
        return;
      }
      if (accel && e.key === "z" && !inEditable(e)) {
        e.preventDefault();
        const op = s.popUndo();
        if (!op) return;
        void (async () => {
          try {
            if (op.kind === "trash") {
              await restoreTrash(op.ids);
              await s.loadTrash();
              await s.refresh();
            } else if (op.kind === "rename") {
              await renamePath(op.to, op.from);
              await s.refresh();
            } else if (op.kind === "create") {
              await trashPaths([op.path]);
              await s.refresh();
            }
          } catch (err) {
            s.toast("error", err instanceof Error ? err.message : String(err));
          }
        })();
        return;
      }
      if (inEditable(e)) return;
      if (e.key === "F3") {
        e.preventDefault();
        s.applyView({ dualPane: !s.settings?.view.dualPane });
        return;
      }
      if (e.key === "F4") {
        e.preventDefault();
        if (s.terminals.length) s.closeAllTerminals();
        else s.addTerminal(s.panes[s.activePane].cwd);
        return;
      }
      if (e.altKey && e.key === "Enter") {
        e.preventDefault();
        const pane = s.panes[s.activePane];
        s.setPropertiesPath(pane.selected.at(-1) ?? pane.cwd);
        return;
      }
      if (accel && e.key === "l") {
        e.preventDefault();
        s.setEditLocation(s.activePane);
        return;
      }
      if (accel && e.key === "i") {
        e.preventDefault();
        s.setEditFilter(s.activePane);
        return;
      }
      if (accel && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        const size = s.settings?.view.iconSize ?? 34;
        s.applyView({ iconSize: Math.min(64, size + 4) });
        return;
      }
      if (accel && e.key === "-") {
        e.preventDefault();
        const size = s.settings?.view.iconSize ?? 34;
        s.applyView({ iconSize: Math.max(16, size - 4) });
        return;
      }
      if (accel && e.key === "0") {
        e.preventDefault();
        s.applyView({ iconSize: 34 });
        return;
      }
      if (e.altKey && !accel && e.key === ".") {
        e.preventDefault();
        s.applyView({ showHidden: !s.settings?.view.showHidden });
        return;
      }
      if (e.altKey && !accel && e.key === "ArrowLeft") {
        e.preventDefault();
        void s.goBack(s.activePane);
        return;
      }
      if (e.altKey && !accel && e.key === "ArrowRight") {
        e.preventDefault();
        void s.goForward(s.activePane);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return null;
}
