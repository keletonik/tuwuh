/**
 * Window layout.
 *
 * Every secondary region is a collapsible, resizable panel: the editor opens
 * when a text file is opened and collapses back out of the way, and the
 * terminal does the same. The file panes are the one region that never
 * collapses, because a file manager with no file list is not a file manager.
 */
import { Group, Panel, Separator } from "react-resizable-panels";
import { Bot, Columns2, PanelLeft, Settings, SquareTerminal, X } from "lucide-react";
import { useApp } from "@/lib/store";
import { Pane } from "./pane";
import { Sidebar } from "./sidebar";
import { EditorPane } from "./editor";
import { TerminalPane } from "./terminal";
import { SettingsPanel } from "./settings";
import { Assistant } from "./assistant";
import { InfoPanel } from "./info";

export function Workbench() {
  const settings = useApp((s) => s.settings);
  const tabs = useApp((s) => s.tabs);
  const terminalOpen = useApp((s) => s.terminalOpen);
  const settingsOpen = useApp((s) => s.settingsOpen);
  const assistantOpen = useApp((s) => s.assistantOpen);
  const infoOpen = useApp((s) => s.infoOpen);
  const toasts = useApp((s) => s.toasts);
  const dismissToast = useApp((s) => s.dismissToast);
  const applyView = useApp((s) => s.applyView);
  const navigate = useApp((s) => s.navigate);

  if (!settings) return null;
  const dual = settings.view.dualPane;
  const editorOpen = tabs.length > 0;

  return (
    <div className="fm-shell">
      <header className="fm-chrome">
        <span className="fm-wordmark">Tuwuh</span>
        <div className="fm-chrome-actions">
          <button
            type="button"
            aria-pressed={dual}
            data-on={dual || undefined}
            title="Dual pane"
            onClick={() => {
              applyView({ dualPane: !dual });
              if (!dual) void navigate("b", useApp.getState().panes.a.cwd, false);
            }}
          >
            <Columns2 size={15} />
          </button>
          <button
            type="button"
            aria-pressed={infoOpen}
            data-on={infoOpen || undefined}
            title="Information panel"
            onClick={() => useApp.getState().setInfoOpen(!infoOpen)}
          >
            <PanelLeft size={15} />
          </button>
          <button
            type="button"
            aria-pressed={terminalOpen}
            data-on={terminalOpen || undefined}
            title="Terminal"
            onClick={() => useApp.getState().setTerminalOpen(!terminalOpen)}
          >
            <SquareTerminal size={15} />
          </button>
          <button
            type="button"
            aria-pressed={assistantOpen}
            data-on={assistantOpen || undefined}
            title="Assistant"
            onClick={() => useApp.getState().setAssistantOpen(!assistantOpen)}
          >
            <Bot size={15} />
          </button>
          <button
            type="button"
            aria-pressed={settingsOpen}
            data-on={settingsOpen || undefined}
            title="Settings"
            onClick={() => useApp.getState().setSettingsOpen(!settingsOpen)}
          >
            <Settings size={15} />
          </button>
        </div>
      </header>

      <Group orientation="horizontal" className="fm-body" id="tuwuh-h">
        <Panel defaultSize="16" minSize="10" maxSize="30" collapsible id="places">
          <Sidebar />
        </Panel>
        <Separator className="fm-handle fm-handle-v" />

        <Panel minSize="30" id="centre">
          <Group orientation="vertical" id="tuwuh-v">
            <Panel minSize="20" id="panes">
              {dual ? (
                <Group orientation="horizontal" id="tuwuh-panes">
                  <Panel minSize="20" id="pane-a">
                    <Pane id="a" />
                  </Panel>
                  <Separator className="fm-handle fm-handle-v" />
                  <Panel minSize="20" id="pane-b">
                    <Pane id="b" />
                  </Panel>
                </Group>
              ) : (
                <Pane id="a" />
              )}
            </Panel>

            {editorOpen && (
              <>
                <Separator className="fm-handle fm-handle-h" />
                <Panel defaultSize="45" minSize="12" collapsible id="editor">
                  <EditorPane />
                </Panel>
              </>
            )}

            {terminalOpen && (
              <>
                <Separator className="fm-handle fm-handle-h" />
                <Panel defaultSize="30" minSize="10" collapsible id="terminal">
                  <TerminalPane />
                </Panel>
              </>
            )}
          </Group>
        </Panel>

        {(infoOpen || assistantOpen) && (
          <>
            <Separator className="fm-handle fm-handle-v" />
            <Panel defaultSize="22" minSize="14" maxSize="42" collapsible id="aside">
              {assistantOpen ? <Assistant /> : <InfoPanel />}
            </Panel>
          </>
        )}
      </Group>

      {settingsOpen && (
        <div className="fm-overlay" onMouseDown={() => useApp.getState().setSettingsOpen(false)}>
          <div onMouseDown={(e) => e.stopPropagation()}>
            <SettingsPanel />
          </div>
        </div>
      )}

      <div className="fm-toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="fm-toast" data-kind={t.kind}>
            <span>{t.text}</span>
            <button type="button" aria-label="Dismiss" onClick={() => dismissToast(t.id)}>
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
