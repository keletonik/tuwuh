/**
 * Push a theme onto the document as CSS custom properties.
 *
 * The category tones are written here too. Previously they were static values
 * in `:root`, so switching theme recoloured the chrome but left every file icon
 * on the old palette: on the light theme those tones were the ones derived for
 * a dark background and failed contrast outright.
 */
import { themeById, type ThemeTokens } from "./themes.ts";

export function applyTheme(id: string): ThemeTokens {
  const t = themeById(id);
  const root = document.documentElement;

  const set = (name: string, value: string) => root.style.setProperty(name, value);

  set("--fm-bg", t.bg);
  set("--fm-bg1", t.bg1);
  set("--fm-bg2", t.bg2);
  set("--fm-fg", t.fg);
  set("--fm-muted", t.muted);
  set("--fm-accent", t.accent);
  set("--fm-wood", t.wood);
  set("--fm-border", t.border);
  set("--fm-danger", t.danger);
  set("--fm-warn", t.warn);
  set("--fm-editor-bg", t.editorBg);

  for (const [key, value] of Object.entries(t.tones)) {
    set(`--fm-tone-${key}`, value);
  }

  // Lets the UA paint form controls, scrollbars and focus rings for the right
  // polarity. Without it the light theme gets dark native widgets.
  set("color-scheme", t.dark ? "dark" : "light");
  root.dataset.theme = t.id;
  root.dataset.polarity = t.dark ? "dark" : "light";

  return t;
}
