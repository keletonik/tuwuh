/**
 * Window chrome gate. Decorations must stay off (we draw them), the capability
 * must allow min/max/close/resize/drag, and the CSS must keep a visible frame
 * plus a grabable splitter.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let failed = 0;
const fail = (m) => {
  failed += 1;
  console.log(`FAIL ${m}`);
};

const conf = JSON.parse(readFileSync(join(root, "src-tauri/tauri.conf.json"), "utf8"));
const win = conf.app.windows[0];
if (win.decorations !== false) fail(`decorations should be false, got ${win.decorations}`);
if (win.resizable !== true) fail("window must stay resizable");
if (win.dragDropEnabled !== true) fail("dragDropEnabled should be true");
if (win.shadow !== true) fail("shadow should be true so the client border has an edge");
const lib = readFileSync(join(root, "src-tauri/src/lib.rs"), "utf8");
if (!lib.includes(".shadow(true)")) fail("new_window must set shadow(true)");

const caps = JSON.parse(readFileSync(join(root, "src-tauri/capabilities/default.json"), "utf8"));
if (!caps.windows.includes("*")) fail("capabilities.windows must include * so extra windows work");
for (const perm of [
  "core:window:allow-close",
  "core:window:allow-minimize",
  "core:window:allow-toggle-maximize",
  "core:window:allow-start-dragging",
  "core:window:allow-start-resize-dragging",
]) {
  if (!caps.permissions.includes(perm)) fail(`missing permission ${perm}`);
}

const css = readFileSync(join(root, "src/styles.css"), "utf8");
if (!css.includes(".fm-shell {") && !css.includes(".fm-shell {")) {
  fail("fm-shell rule missing");
}
if (!css.includes("border: 1px solid var(--fm-border)")) fail("window border token missing");
if (!css.includes(".fm-win-edge")) fail("resize edges missing");
if (!css.includes(".fm-handle-v::before")) fail("splitter hit target missing");
if (!css.includes("minmax(0, 1fr)")) fail("details name column must shrink, not overflow");
if (!css.includes(".fm-context")) fail("context menu class missing");
if (css.includes("position: relative;\n}") && /\/\* Context menu/.test(css) === false) {
  /* not a hard fail */
}

if (failed) {
  console.log(`${failed} window check(s) failed`);
  process.exit(1);
}
console.log("ok   window  decorations off, chrome perms, border, splitters, details columns");
