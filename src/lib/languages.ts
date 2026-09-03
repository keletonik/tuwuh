export const EXT_LANG: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  css: "css",
  scss: "scss",
  less: "less",
  html: "html",
  htm: "html",
  md: "markdown",
  markdown: "markdown",
  py: "python",
  rs: "rust",
  go: "go",
  java: "java",
  kt: "kotlin",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  hpp: "cpp",
  cs: "csharp",
  php: "php",
  rb: "ruby",
  swift: "swift",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  fish: "shell",
  yml: "yaml",
  yaml: "yaml",
  xml: "xml",
  svg: "xml",
  sql: "sql",
  toml: "ini",
  ini: "ini",
  conf: "ini",
  dockerfile: "dockerfile",
  lua: "lua",
  r: "r",
  dart: "dart",
  vue: "html",
  svelte: "html",
  graphql: "graphql",
  gql: "graphql",
  proto: "protobuf",
  tex: "plaintext",
  txt: "plaintext",
  log: "plaintext",
  env: "ini",
  gitignore: "plaintext",
  pkgbuild: "shell",
};

export function langFromName(name: string): string {
  const lower = name.toLowerCase();
  if (lower === "dockerfile" || lower === "makefile" || lower === "pkgbuild") {
    return EXT_LANG[lower] ?? "plaintext";
  }
  const ext = lower.includes(".") ? lower.slice(lower.lastIndexOf(".") + 1) : "";
  return EXT_LANG[ext] ?? "plaintext";
}

export function isImageName(name: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg|ico|bmp)$/i.test(name);
}

export function isMarkdownName(name: string): boolean {
  return /\.(md|markdown)$/i.test(name);
}

export const MONACO_LANGS = [
  "plaintext",
  "javascript",
  "typescript",
  "json",
  "html",
  "css",
  "scss",
  "markdown",
  "python",
  "rust",
  "go",
  "java",
  "c",
  "cpp",
  "csharp",
  "php",
  "ruby",
  "swift",
  "shell",
  "yaml",
  "xml",
  "sql",
  "ini",
  "dockerfile",
  "lua",
  "kotlin",
  "graphql",
] as const;
