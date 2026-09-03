import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Sizes go past MB: a file manager that renders a 40 GB disk image as
 * "40960.0 MB" is unreadable at exactly the moment the number matters.
 */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB", "PB"];
  let value = n / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  // One decimal below 100, none above, so the column keeps a steady width.
  return `${value < 100 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/** Takes epoch **seconds**, which is what the backend reports for mtime. */
export function formatTime(epochSeconds: number): string {
  if (!epochSeconds) return "—";
  const d = new Date(epochSeconds * 1000);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleString(undefined, {
    year: sameYear ? undefined : "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Unix permission bits as `rwxr-xr-x`. */
export function formatMode(mode: number): string {
  const bit = (n: number, c: string) => (mode & n ? c : "-");
  return (
    bit(0o400, "r") + bit(0o200, "w") + bit(0o100, "x") +
    bit(0o040, "r") + bit(0o020, "w") + bit(0o010, "x") +
    bit(0o004, "r") + bit(0o002, "w") + bit(0o001, "x")
  );
}

export function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(hex: string): number {
  const c = hex.replace("#", "").trim();
  if (c.length !== 6) return 0;
  const r = srgb(parseInt(c.slice(0, 2), 16) / 255);
  const g = srgb(parseInt(c.slice(2, 4), 16) / 255);
  const b = srgb(parseInt(c.slice(4, 6), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function srgb(c: number) {
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
