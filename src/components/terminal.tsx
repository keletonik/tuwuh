/**
 * The terminal pane.
 *
 * xterm.js renders; the shell is a real process on a real pty in the Rust
 * backend. Keystrokes are forwarded byte for byte and output is streamed back,
 * so job control, curses programs and shell completion behave as they do in any
 * other terminal rather than being special-cased here.
 *
 * Each tab keeps its own session mounted while the pane is open. Hiding a tab
 * uses visibility rather than unmounting, because tearing down xterm kills the
 * pty. Changing dock position remounts the whole pane (it moves Groups) and
 * that does restart the shells; that is the honest cost of the layout change.
 */
import { useEffect, useRef } from "react";
import { Plus, X, PanelTop, PanelRight, PanelBottom } from "lucide-react";
import { Terminal as Xterm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import {
  basename,
  closeTerminal,
  onTerminalExit,
  onTerminalOutput,
  resizeTerminal,
  spawnTerminal,
  writeTerminal,
} from "@/lib/api";
import { parseTerminalDock, TERMINAL_DOCKS, type TerminalDock } from "@/lib/layout";
import { useApp } from "@/lib/store";
import { themeById } from "@/lib/themes";

const DOCK_ICON: Record<TerminalDock, typeof PanelTop> = {
  top: PanelTop,
  right: PanelRight,
  bottom: PanelBottom,
};

function xtermTheme(themeId: string) {
  const t = themeById(themeId);
  return {
    background: t.bg,
    foreground: t.fg,
    cursor: t.accent,
    selectionBackground: `${t.accent}55`,
  };
}

function TerminalSession({ cwd, active }: { cwd: string; active: boolean }) {
  const themeId = useApp((s) => s.settings?.view.theme ?? "forest");
  const fontFamily = useApp((s) => s.settings?.editor.fontFamily ?? "monospace");
  const fontSize = useApp((s) => s.settings?.editor.fontSize ?? 13);
  const toast = useApp((s) => s.toast);

  const hostRef = useRef<HTMLDivElement>(null);
  const idRef = useRef<string | null>(null);
  const termRef = useRef<Xterm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Xterm({
      fontFamily,
      fontSize,
      cursorBlink: true,
      allowProposedApi: true,
      theme: xtermTheme(themeId),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(host);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    let disposed = false;
    const unlisteners: Array<() => void> = [];

    void (async () => {
      try {
        const id = await spawnTerminal(cwd, term.cols, term.rows);
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
      termRef.current = null;
      fitRef.current = null;
      if (id) void closeTerminal(id);
      term.dispose();
    };
    // Theme and font updates are applied in the effect below so a palette
    // change does not kill the running shell.
  }, [cwd, toast]);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.theme = xtermTheme(themeId);
    term.options.fontFamily = fontFamily;
    term.options.fontSize = fontSize;
    fitRef.current?.fit();
  }, [themeId, fontFamily, fontSize]);

  useEffect(() => {
    if (!active) return;
    fitRef.current?.fit();
    const id = idRef.current;
    const term = termRef.current;
    if (id && term) void resizeTerminal(id, term.cols, term.rows).catch(() => undefined);
    term?.focus();
  }, [active]);

  return <div className="fm-terminal-host" ref={hostRef} />;
}

export function TerminalPane() {
  const tabs = useApp((s) => s.terminals);
  const active = useApp((s) => s.activeTerminal);
  const dock = parseTerminalDock(useApp((s) => s.settings?.view.terminalDock));
  const paneCwd = useApp((s) => s.panes[s.activePane].cwd);
  const addTerminal = useApp((s) => s.addTerminal);
  const closeTerminalTab = useApp((s) => s.closeTerminalTab);
  const setActiveTerminal = useApp((s) => s.setActiveTerminal);
  const applyView = useApp((s) => s.applyView);

  return (
    <div className="fm-terminal">
      <header className="fm-terminal-bar">
        <div className="fm-term-tabs" role="tablist" aria-label="Terminals">
          {tabs.map((t) => (
            <div
              key={t.id}
              role="tab"
              aria-selected={t.id === active}
              className="fm-term-tab"
              data-active={t.id === active || undefined}
              onMouseDown={() => setActiveTerminal(t.id)}
              title={t.cwd}
            >
              <span>{basename(t.cwd)}</span>
              <button
                type="button"
                aria-label={`Close terminal in ${basename(t.cwd)}`}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  closeTerminalTab(t.id);
                }}
              >
                <X size={11} />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="fm-term-add"
            aria-label="New terminal"
            title="New terminal"
            onClick={() => addTerminal(paneCwd)}
          >
            <Plus size={13} />
          </button>
        </div>
        <div className="fm-term-docks" role="group" aria-label="Terminal position">
          {TERMINAL_DOCKS.map((d) => {
            const Icon = DOCK_ICON[d];
            return (
              <button
                key={d}
                type="button"
                aria-pressed={dock === d}
                data-on={dock === d || undefined}
                title={`Dock ${d}`}
                aria-label={`Dock terminal ${d}`}
                onClick={() => applyView({ terminalDock: d })}
              >
                <Icon size={13} />
              </button>
            );
          })}
        </div>
      </header>
      <div className="fm-terminal-sessions">
        {tabs.map((t) => (
          <div
            key={t.id}
            className="fm-terminal-session"
            data-active={t.id === active || undefined}
          >
            <TerminalSession cwd={t.cwd} active={t.id === active} />
          </div>
        ))}
      </div>
    </div>
  );
}
