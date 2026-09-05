/**
 * Native window chrome. Tuwuh draws its own titlebar because GTK decorations
 * on Wayland often produce a borderless window with no min/max/close and no
 * resize edges. Every call is a no-op outside Tauri so the Vite preview still
 * loads.
 */
export type ResizeEdge =
  | "North"
  | "South"
  | "East"
  | "West"
  | "NorthEast"
  | "NorthWest"
  | "SouthEast"
  | "SouthWest";

export const RESIZE_EDGES: ResizeEdge[] = [
  "North",
  "South",
  "East",
  "West",
  "NorthEast",
  "NorthWest",
  "SouthEast",
  "SouthWest",
];

async function current() {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow();
}

export async function windowMinimize() {
  try {
    await (await current()).minimize();
  } catch {
    /* preview */
  }
}

export async function windowToggleMaximize() {
  try {
    await (await current()).toggleMaximize();
  } catch {
    /* preview */
  }
}

export async function windowClose() {
  try {
    await (await current()).close();
  } catch {
    window.close();
  }
}

export async function windowStartDrag() {
  try {
    await (await current()).startDragging();
  } catch {
    /* preview */
  }
}

export async function windowStartResize(direction: ResizeEdge) {
  try {
    await (await current()).startResizeDragging(direction);
  } catch {
    /* preview */
  }
}

export async function windowIsMaximized(): Promise<boolean> {
  try {
    return await (await current()).isMaximized();
  } catch {
    return false;
  }
}

export async function onWindowResized(fn: () => void): Promise<() => void> {
  try {
    const win = await current();
    const un = await win.onResized(() => fn());
    return () => un();
  } catch {
    return () => undefined;
  }
}
