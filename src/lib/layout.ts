/**
 * Where secondary panes sit in the workbench.
 *
 * The panel tree in workbench.tsx has to change shape when the terminal moves
 * from the bottom to the right or the top, so the decision lives here as a
 * pure function: the layout code cannot drift from the settings value, and the
 * check-layout script can mutation-test it without booting Tauri.
 */

export const TERMINAL_DOCKS = ["top", "right", "bottom"] as const;
export type TerminalDock = (typeof TERMINAL_DOCKS)[number];

/** Which Group the terminal panel belongs to, and which end of it. */
export type TerminalSlot = "vertical-start" | "vertical-end" | "horizontal-end";

export function isTerminalDock(value: unknown): value is TerminalDock {
  return value === "top" || value === "right" || value === "bottom";
}

/** Unknown, missing or legacy values (including "left") fall back to bottom. */
export function parseTerminalDock(value: unknown): TerminalDock {
  return isTerminalDock(value) ? value : "bottom";
}

export function terminalSlot(dock: TerminalDock): TerminalSlot {
  switch (dock) {
    case "top":
      return "vertical-start";
    case "right":
      return "horizontal-end";
    case "bottom":
      return "vertical-end";
  }
}
