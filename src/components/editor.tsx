/**
 * The code editor pane.
 *
 * Monaco is the editor that powers VS Code, so syntax highlighting, bracket
 * matching, auto-indent, inline suggestions and the command palette are the
 * real implementations rather than approximations. What this file adds is the
 * part Monaco has no opinion about: which buffer is open, whether it differs
 * from what is on disk, and writing it back.
 */
import { useCallback, useEffect, useRef } from "react";
import Editor, { type Monaco } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { Save, X } from "lucide-react";
import { writeTextFile } from "@/lib/api";
import { langFromName } from "@/lib/languages";
import { isDirty, useApp } from "@/lib/store";
import { THEMES, type ThemeId } from "@/lib/themes";

const THEME_NAME = "tuwuh";

/** Map the app palette onto a Monaco theme so the editor is not a bright
 *  rectangle sitting inside a dark file manager. */
function defineTheme(monaco: Monaco, id: ThemeId) {
  const t = THEMES[id] ?? THEMES.forest;
  monaco.editor.defineTheme(THEME_NAME, {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": t.editorBg,
      "editor.foreground": t.fg,
      "editorLineNumber.foreground": t.muted,
      "editorLineNumber.activeForeground": t.fg,
      "editorCursor.foreground": t.accent,
      "editor.selectionBackground": `${t.accent}44`,
      "editor.lineHighlightBackground": t.bg1,
      "editorIndentGuide.background1": t.border,
      "editorWidget.background": t.bg2,
      "editorWidget.border": t.border,
      "editorSuggestWidget.background": t.bg2,
      "editorSuggestWidget.border": t.border,
      "editorGutter.background": t.editorBg,
      "scrollbarSlider.background": `${t.border}cc`,
    },
  });
  monaco.editor.setTheme(THEME_NAME);
}

export function EditorPane() {
  const tabs = useApp((s) => s.tabs);
  const activeTab = useApp((s) => s.activeTab);
  const settings = useApp((s) => s.settings);
  const setDraft = useApp((s) => s.setDraft);
  const markSaved = useApp((s) => s.markSaved);
  const closeTab = useApp((s) => s.closeTab);
  const setActiveTab = useApp((s) => s.setActiveTab);
  const toast = useApp((s) => s.toast);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);

  const tab = tabs.find((t) => t.path === activeTab) ?? null;

  const save = useCallback(async () => {
    const current = useApp.getState().tabs.find((t) => t.path === useApp.getState().activeTab);
    if (!current) return;
    if (current.readonly) {
      toast(
        "error",
        current.truncated
          ? "This buffer was truncated on read. Saving would discard the rest of the file."
          : "This file is read-only.",
      );
      return;
    }
    try {
      await writeTextFile(current.path, current.draft);
      markSaved(current.path);
      // Refresh so size and modified time in the listing match the disk.
      await useApp.getState().refreshPath(current.path.slice(0, current.path.lastIndexOf("/")) || "/");
      toast("success", `Saved ${current.name}`);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    }
  }, [markSaved, toast]);

  /* Monaco's own automaticLayout observes the element it sits in, and inside a
     resizable panel that turns into a feedback loop: it resizes, the panel
     observer fires, it measures again. WebKit reports that as an endless
     "ResizeObserver loop completed with undelivered notifications" and the
     editor never paints. Measuring the host ourselves and laying out on the
     next frame breaks the cycle, because the layout call lands after the
     observer has finished delivering. */
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let frame = 0;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        editorRef.current?.layout({
          width: Math.max(0, Math.floor(rect.width)),
          height: Math.max(0, Math.floor(rect.height)),
        });
      });
    });
    ro.observe(host);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
    };
  }, []);

  /* Ctrl+S is bound on the window as well as inside Monaco: the shortcut has to
     work when focus is in the tab strip, not only in the text area. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);

  if (!settings) return null;

  if (!tab) {
    return (
      <div className="fm-editor fm-editor-empty">
        <p className="fm-muted-line">Open a file to edit it here.</p>
      </div>
    );
  }

  const e = settings.editor;

  return (
    <div className="fm-editor">
      <div className="fm-tabs" role="tablist">
        {tabs.map((t) => (
          <div
            key={t.path}
            role="tab"
            aria-selected={t.path === activeTab}
            className="fm-tab"
            data-active={t.path === activeTab || undefined}
            data-dirty={isDirty(t) || undefined}
            onMouseDown={() => setActiveTab(t.path)}
            title={t.path}
          >
            <span className="fm-tab-name">
              {t.name}
              {isDirty(t) && <span className="fm-tab-dot" aria-label="unsaved changes" />}
            </span>
            <button
              type="button"
              aria-label={`Close ${t.name}`}
              onMouseDown={(ev) => {
                ev.stopPropagation();
                if (isDirty(t) && !window.confirm(`${t.name} has unsaved changes. Close it?`)) {
                  return;
                }
                closeTab(t.path);
              }}
            >
              <X size={12} />
            </button>
          </div>
        ))}
        <div className="fm-tabs-spacer" />
        <button
          type="button"
          className="fm-tab-save"
          onClick={() => void save()}
          disabled={!isDirty(tab) || tab.readonly}
          title={tab.readonly ? "Read-only" : "Save (Ctrl S)"}
        >
          <Save size={13} /> Save
        </button>
      </div>

      {tab.truncated && (
        <p className="fm-banner">
          Opened read-only: the file is larger than the read limit, so only the first part is
          shown.
        </p>
      )}

      <div className="fm-monaco-host" ref={hostRef}>
        <Editor
          key={tab.path}
          className="fm-monaco"
        language={langFromName(tab.name)}
        value={tab.draft}
        onChange={(v) => setDraft(tab.path, v ?? "")}
        beforeMount={(monaco) => defineTheme(monaco, settings.view.theme as ThemeId)}
        onMount={(ed, monaco) => {
          editorRef.current = ed;
          ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => void save());
          // The observer's first callback fires before this ref is set, so
          // without an explicit layout here the editor keeps the 0x0 size it
          // was created with and paints nothing.
          const host = hostRef.current;
          if (host) {
            const r = host.getBoundingClientRect();
            ed.layout({ width: Math.floor(r.width), height: Math.floor(r.height) });
          }
        }}
        theme={THEME_NAME}
        options={{
          readOnly: tab.readonly,
          fontFamily: e.fontFamily,
          fontSize: e.fontSize,
          tabSize: e.tabSize,
          insertSpaces: e.insertSpaces,
          wordWrap: e.wordWrap ? "on" : "off",
          minimap: { enabled: e.minimap },
          lineNumbers: e.lineNumbers ? "on" : "off",
          bracketPairColorization: { enabled: e.bracketPairColorization },
          // The "predictive syntax" part: inline suggestions plus the normal
          // suggestion widget, with auto-indent and auto-closing pairs on.
          inlineSuggest: { enabled: e.inlineSuggestions },
          quickSuggestions: { other: true, comments: false, strings: true },
          suggestOnTriggerCharacters: true,
          autoIndent: "full",
          formatOnPaste: true,
          formatOnType: true,
          autoClosingBrackets: "languageDefined",
          autoClosingQuotes: "languageDefined",
          renderWhitespace: "selection",
          smoothScrolling: true,
          scrollBeyondLastLine: false,
          automaticLayout: false,
          padding: { top: 8, bottom: 8 },
          }}
        />
      </div>
    </div>
  );
}
