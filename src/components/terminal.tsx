/**
 * The terminal pane.
 *
 * xterm.js renders; the shell is a real process on a real pty in the Rust
 * backend. Keystrokes are forwarded byte for byte and output is streamed back,
 * so job control, curses programs and shell completion behave as they do in any
 * other terminal rather than being special-cased here.
 */
import { useEffect, useRef } from "react";
import { Terminal as Xterm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import {
  closeTerminal,
  onTerminalExit,
  onTerminalOutput,
  resizeTerminal,
  spawnTerminal,
  writeTerminal,
} from "@/lib/api";
import { useApp } from "@/lib/store";
import { THEMES, type ThemeId } from "@/lib/themes";

export function TerminalPane() {
  const cwd = useApp((s) => s.terminalCwd);
  const themeId = useApp((s) => s.settings?.view.theme ?? "forest") as ThemeId;
  const fontFamily = useApp((s) => s.settings?.editor.fontFamily ?? "monospace");
  const fontSize = useApp((s) => s.settings?.editor.fontSize ?? 13);
  const toast = useApp((s) => s.toast);

  const hostRef = useRef<HTMLDivElement>(null);
  const idRef = useRef<string | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const t = THEMES[themeId] ?? THEMES.forest;
    const term = new Xterm({
      fontFamily,
      fontSize,
      cursorBlink: true,
      allowProposedApi: true,
      theme: {
        background: t.bg,
        foreground: t.fg,
        cursor: t.accent,
        selectionBackground: `${t.accent}55`,
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(host);
    fit.fit();

    let disposed = false;
    const unlisteners: Array<() => void> = [];

    void (async () => {
      try {
        const id = await spawnTerminal(cwd, term.cols, term.rows);
        // The effect can be torn down while the spawn is in flight; without
        // this the shell would be started and then leaked.
        if (disposed) {
          void closeTerminal(id);
          return;
        }
        idRef.current = id;

        unlisteners.push(
          await onTerminalOutput((p) => {
            if (p.id === id) term.write(p.data);
          }),
        );
        unlisteners.push(
          await onTerminalExit((p) => {
            if (p.id === id) term.write("\r\n\x1b[2m[process exited]\x1b[0m\r\n");
          }),
        );

        term.onData((data) => void writeTerminal(id, data).catch(() => undefined));
      } catch (e) {
        term.write(`\r\n\x1b[31m${e instanceof Error ? e.message : String(e)}\x1b[0m\r\n`);
        toast("error", e instanceof Error ? e.message : String(e));
      }
    })();

    const ro = new ResizeObserver(() => {
      fit.fit();
      const id = idRef.current;
      if (id) void resizeTerminal(id, term.cols, term.rows).catch(() => undefined);
    });
    ro.observe(host);

    return () => {
      disposed = true;
      ro.disconnect();
      for (const off of unlisteners) off();
      const id = idRef.current;
      idRef.current = null;
      if (id) void closeTerminal(id);
      term.dispose();
    };
    // A change of directory or theme starts a fresh shell rather than mutating
    // the running one, which is the only honest way to change its cwd.
  }, [cwd, themeId, fontFamily, fontSize, toast]);

  return (
    <div className="fm-terminal">
      <header className="fm-terminal-bar">
        <span className="fm-terminal-cwd" title={cwd}>
          {cwd}
        </span>
      </header>
      <div className="fm-terminal-host" ref={hostRef} />
    </div>
  );
}
