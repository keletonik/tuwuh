/**
 * Global shortcuts that the menu advertises. Bound here so the labels in the
 * Alt bar are not decoration.
 *
 * Ctrl+, and Ctrl+Q stay active in fields. Alt+Left/Right are skipped inside
 * inputs and the terminal, where those chords already mean something.
 */
import { useEffect } from "react";
import { useApp } from "@/lib/store";

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
      if (accel && e.key === ",") {
        e.preventDefault();
        useApp.getState().setSettingsOpen(true);
        return;
      }
      if (accel && e.key.toLowerCase() === "q") {
        e.preventDefault();
        window.close();
        return;
      }
      if (e.key === "Escape") {
        const s = useApp.getState();
        if (s.settingsOpen) {
          e.preventDefault();
          void s.closeSettings();
          return;
        }
        if (s.menuOpen) {
          e.preventDefault();
          s.setMenuOpen(false);
        }
        return;
      }
      if (inEditable(e)) return;
      if (e.altKey && !accel && e.key === "ArrowLeft") {
        e.preventDefault();
        void useApp.getState().goBack(useApp.getState().activePane);
        return;
      }
      if (e.altKey && !accel && e.key === "ArrowRight") {
        e.preventDefault();
        void useApp.getState().goForward(useApp.getState().activePane);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return null;
}
