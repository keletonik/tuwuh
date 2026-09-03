export type ThemeId = "forest" | "canopy" | "mist" | "birch";

export interface ThemeTokens {
  id: ThemeId;
  name: string;
  bg: string;
  bg1: string;
  bg2: string;
  fg: string;
  muted: string;
  accent: string;
  wood: string;
  border: string;
  activity: string;
  status: string;
  danger: string;
  warn: string;
  editorBg: string;
}

export const THEMES: Record<ThemeId, ThemeTokens> = {
  forest: {
    id: "forest",
    name: "Forest",
    bg: "#0b130f",
    bg1: "#101a14",
    bg2: "#16211a",
    fg: "#e4ede6",
    muted: "#8b9d90",
    accent: "#4e8f63",
    wood: "#c4b08a",
    border: "#24332a",
    activity: "#08110c",
    status: "#0d1812",
    danger: "#c45c4a",
    warn: "#c4a15a",
    editorBg: "#0b130f",
  },
  canopy: {
    id: "canopy",
    name: "Canopy",
    bg: "#070d0a",
    bg1: "#0c1510",
    bg2: "#122018",
    fg: "#d5e2d8",
    muted: "#7a8f80",
    accent: "#3f7a54",
    wood: "#b89a72",
    border: "#1b2a21",
    activity: "#050a08",
    status: "#0a1410",
    danger: "#b85c4c",
    warn: "#b89650",
    editorBg: "#070d0a",
  },
  mist: {
    id: "mist",
    name: "Mist",
    bg: "#121816",
    bg1: "#181f1c",
    bg2: "#1f2824",
    fg: "#e8eee9",
    muted: "#9aa89e",
    accent: "#6ea57f",
    wood: "#d0c0a0",
    border: "#2c3a32",
    activity: "#0e1412",
    status: "#141c18",
    danger: "#d07060",
    warn: "#d0b06a",
    editorBg: "#121816",
  },
  birch: {
    id: "birch",
    name: "Birch",
    bg: "#f3f1ea",
    bg1: "#e8e6de",
    bg2: "#ddd9ce",
    fg: "#1c241e",
    muted: "#5c6b60",
    accent: "#2f6a45",
    wood: "#7a5c38",
    border: "#cfc8b8",
    activity: "#ebe7dc",
    status: "#e4e0d4",
    danger: "#a33b2c",
    warn: "#8a6a20",
    editorBg: "#f7f5ef",
  },
};

export const TOKEN_KEYS = [
  "bg",
  "bg1",
  "bg2",
  "fg",
  "muted",
  "accent",
  "wood",
  "border",
  "activity",
  "status",
  "danger",
  "warn",
  "editorBg",
] as const;

export type TokenKey = (typeof TOKEN_KEYS)[number];

export function applyTheme(tokens: ThemeTokens, custom?: Partial<Record<TokenKey, string>>) {
  const root = document.documentElement;
  const merged = { ...tokens, ...custom };
  root.style.setProperty("--tu-bg", merged.bg);
  root.style.setProperty("--tu-bg-1", merged.bg1);
  root.style.setProperty("--tu-bg-2", merged.bg2);
  root.style.setProperty("--tu-fg", merged.fg);
  root.style.setProperty("--tu-muted", merged.muted);
  root.style.setProperty("--tu-accent", merged.accent);
  root.style.setProperty("--tu-wood", merged.wood);
  root.style.setProperty("--tu-border", merged.border);
  root.style.setProperty("--tu-activity", merged.activity);
  root.style.setProperty("--tu-status", merged.status);
  root.style.setProperty("--tu-danger", merged.danger);
  root.style.setProperty("--tu-warn", merged.warn);
  root.style.setProperty("--tu-editor", merged.editorBg);
  root.dataset.theme = tokens.id;
}

export const FOLDER_SWATCHES = [
  "#4e8f63",
  "#3d7a9e",
  "#c4a15a",
  "#c47a4a",
  "#8b6bb0",
  "#c46b7a",
  "#6b8f8a",
  "#c4b08a",
  "#8b9d90",
  "#5a7a6a",
];

export type IconPack = "outline" | "filled" | "arch";
