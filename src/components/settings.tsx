/**
 * Settings, including the AI provider configuration.
 *
 * API keys are write-only from here. They go straight to the OS keyring in the
 * backend and there is no command that reads one back, so this screen can tell
 * you a key is configured but can never show it. That is deliberate: the
 * webview is the part most likely to leak a secret through a log or a crash
 * report, so it never holds one.
 *
 * Each provider keeps its own default model and its own base URL. Switching
 * from Claude to a local Ollama must not send `claude-sonnet-5` to localhost,
 * and an Ollama URL must not follow the next request to Hugging Face.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, KeyRound, PlugZap, Trash2, TriangleAlert } from "lucide-react";
import {
  aiChat,
  deleteProviderKey,
  providerStatus,
  setProviderKey,
  type ProviderId,
  type ProviderStatus,
  type Settings,
} from "@/lib/api";
import { parseTerminalDock, TERMINAL_DOCKS, type TerminalDock } from "@/lib/layout";
import { baseUrlFor, modelFor, PROVIDERS } from "@/lib/providers";
import { useApp } from "@/lib/store";
import { THEME_LIST } from "@/lib/themes";

const DOCK_LABEL: Record<TerminalDock, string> = {
  top: "Top",
  right: "Right",
  bottom: "Bottom",
};

type Section = "ai" | "editor" | "appearance" | "files" | "terminal" | "keyboard";

const SECTIONS: [Section, string][] = [
  ["ai", "AI"],
  ["editor", "Editor"],
  ["appearance", "Appearance"],
  ["files", "Files"],
  ["terminal", "Terminal"],
  ["keyboard", "Keyboard"],
];

export function SettingsPanel() {
  const settings = useApp((s) => s.settings);
  const setSettings = useApp((s) => s.setSettings);
  const closeSettings = useApp((s) => s.closeSettings);
  const persistSettings = useApp((s) => s.persistSettings);
  const applyView = useApp((s) => s.applyView);
  const toast = useApp((s) => s.toast);
  const refresh = useApp((s) => s.refresh);

  const [status, setStatus] = useState<ProviderStatus[]>([]);
  const [keyDraft, setKeyDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<ProviderId | null>(null);
  const [section, setSection] = useState<Section>("ai");
  const [customOpen, setCustomOpen] = useState<Record<string, boolean>>({});
  const customRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const reloadStatus = useCallback(() => {
    providerStatus()
      .then(setStatus)
      .catch((e) => toast("error", e.message));
  }, [toast]);

  useEffect(reloadStatus, [reloadStatus]);

  if (!settings) return null;

  const patch = (p: Partial<Settings>) => setSettings({ ...settings, ...p });
  const st = (id: ProviderId) => status.find((s) => s.provider === id);

  const persist = async () => {
    setSaving(true);
    try {
      await persistSettings();
      await refresh();
      toast("success", "Settings saved.");
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const saveKey = async (provider: ProviderId) => {
    const key = (keyDraft[provider] ?? "").trim();
    if (!key) return;
    try {
      await setProviderKey(provider, key);
      setKeyDraft((d) => ({ ...d, [provider]: "" }));
      reloadStatus();
      toast("success", `${PROVIDERS.find((p) => p.id === provider)?.label} key saved to the keyring.`);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    }
  };

  const removeKey = async (provider: ProviderId) => {
    try {
      await deleteProviderKey(provider);
      reloadStatus();
      toast("success", `${PROVIDERS.find((p) => p.id === provider)?.label} key removed.`);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    }
  };

  const selectProvider = (id: ProviderId) => {
    const model = modelFor(id, settings.ai.models);
    patch({
      ai: {
        ...settings.ai,
        provider: id,
        model,
        models: { ...settings.ai.models, [id]: model },
      },
    });
  };

  const setModel = (id: ProviderId, model: string) => {
    const info = PROVIDERS.find((p) => p.id === id);
    if (info?.models.includes(model)) {
      setCustomOpen((c) => ({ ...c, [id]: false }));
    }
    const next = { ...settings.ai.models, [id]: model };
    patch({
      ai: {
        ...settings.ai,
        models: next,
        model: settings.ai.provider === id ? model : settings.ai.model,
      },
    });
  };

  const setBaseUrl = (id: ProviderId, url: string) => {
    patch({
      ai: {
        ...settings.ai,
        baseUrls: { ...settings.ai.baseUrls, [id]: url },
      },
    });
  };

  const testProvider = async (id: ProviderId) => {
    setTesting(id);
    try {
      await persistSettings();
      const reply = await aiChat(
        [{ role: "user", content: "Reply with the single word pong." }],
        "You are a connection test. Reply with the single word pong.",
        id,
        modelFor(id, settings.ai.models),
      );
      toast("success", `${PROVIDERS.find((p) => p.id === id)?.label} (${reply.model}) replied.`);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(null);
    }
  };

  return (
    <div className="fm-settings" role="dialog" aria-label="Settings" aria-modal="true">
      <header className="fm-settings-head">
        <h2>Settings</h2>
        <div>
          <button type="button" onClick={() => void persist()} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
          <button type="button" onClick={() => void closeSettings()}>
            Close
          </button>
        </div>
      </header>

      <nav className="fm-settings-nav" aria-label="Settings sections">
        {SECTIONS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            data-on={section === id || undefined}
            onClick={() => setSection(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      <div className="fm-settings-body">
        {section === "ai" && (
          <section>
            <h3>Providers</h3>
            <p className="fm-hint">
              Keys go to the OS keyring, never the settings file. Each vendor keeps its own
              default model and its own endpoint. Requests are made from the backend.
            </p>

            {PROVIDERS.map((p) => {
              const s = st(p.id);
              const hasKey = s?.hasKey ?? false;
              const current = modelFor(p.id, settings.ai.models);
              const custom = !p.models.includes(current) || Boolean(customOpen[p.id]);
              return (
                <div key={p.id} className="fm-provider" data-on={settings.ai.provider === p.id || undefined}>
                  <div className="fm-provider-head">
                    <label>
                      <input
                        type="radio"
                        name="provider"
                        checked={settings.ai.provider === p.id}
                        onChange={() => selectProvider(p.id)}
                      />
                      <span>
                        <strong>{p.label}</strong>
                        <small className="fm-provider-blurb">{p.blurb}</small>
                      </span>
                    </label>
                    {p.needsKey ? (
                      <span className="fm-badge" data-ok={hasKey || undefined}>
                        {hasKey ? (
                          <>
                            <Check size={12} /> key configured
                          </>
                        ) : (
                          <>
                            <TriangleAlert size={12} /> no key
                          </>
                        )}
                      </span>
                    ) : (
                      <span className="fm-badge" data-ok>
                        no key needed
                      </span>
                    )}
                  </div>

                  <div className="fm-field-grid">
                    <label>
                      Model
                      <select
                        value={custom ? "__custom__" : current}
                        onChange={(e) => {
                          if (e.target.value === "__custom__") {
                            setCustomOpen((c) => ({ ...c, [p.id]: true }));
                            requestAnimationFrame(() => customRefs.current[p.id]?.focus());
                            return;
                          }
                          setModel(p.id, e.target.value);
                        }}
                      >
                        {p.models.map((m) => (
                          <option key={m} value={m}>
                            {m}
                            {m === p.defaultModel ? " (default)" : ""}
                          </option>
                        ))}
                        <option value="__custom__">Custom…</option>
                      </select>
                    </label>
                    <label>
                      Custom model id
                      <input
                        ref={(el) => {
                          customRefs.current[p.id] = el;
                        }}
                        value={current}
                        spellCheck={false}
                        onChange={(e) => setModel(p.id, e.target.value)}
                      />
                    </label>
                  </div>

                  {p.needsKey && (
                    <div className="fm-provider-key">
                      <KeyRound size={14} />
                      <input
                        type="password"
                        autoComplete="off"
                        spellCheck={false}
                        placeholder={hasKey ? "Replace stored key" : p.keyHint}
                        value={keyDraft[p.id] ?? ""}
                        onChange={(e) => setKeyDraft((d) => ({ ...d, [p.id]: e.target.value }))}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void saveKey(p.id);
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => void saveKey(p.id)}
                        disabled={!(keyDraft[p.id] ?? "").trim()}
                      >
                        Store
                      </button>
                      {hasKey && (
                        <button
                          type="button"
                          aria-label={`Remove ${p.label} key`}
                          onClick={() => void removeKey(p.id)}
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  )}

                  <label className="fm-field">
                    Base URL
                    <input
                      placeholder={p.defaultBaseUrl ?? ""}
                      value={baseUrlFor(p.id, settings.ai.baseUrls)}
                      spellCheck={false}
                      onChange={(e) => setBaseUrl(p.id, e.target.value)}
                    />
                    {p.baseUrlHint && <small className="fm-hint">{p.baseUrlHint}</small>}
                  </label>

                  <div className="fm-provider-actions">
                    <button
                      type="button"
                      onClick={() => void testProvider(p.id)}
                      disabled={testing === p.id || (p.needsKey && !hasKey)}
                    >
                      <PlugZap size={14} />
                      {testing === p.id ? "Testing…" : "Test connection"}
                    </button>
                  </div>
                </div>
              );
            })}

            <div className="fm-field-grid">
              <label>
                Max tokens
                <input
                  type="number"
                  min={64}
                  max={32000}
                  value={settings.ai.maxTokens}
                  onChange={(e) =>
                    patch({ ai: { ...settings.ai, maxTokens: Number(e.target.value) || 2048 } })
                  }
                />
              </label>
              <label>
                Timeout (ms)
                <input
                  type="number"
                  min={1000}
                  max={300000}
                  step={1000}
                  value={settings.ai.timeoutMs}
                  onChange={(e) =>
                    patch({ ai: { ...settings.ai, timeoutMs: Number(e.target.value) || 60000 } })
                  }
                />
              </label>
            </div>

            <label className="fm-check fm-check-warn">
              <input
                type="checkbox"
                checked={settings.ai.allowFileActions}
                onChange={(e) =>
                  patch({ ai: { ...settings.ai, allowFileActions: e.target.checked } })
                }
              />
              <span>
                Let the assistant run file operations
                <small>
                  Off by default. When on, the assistant can create, rename, move and trash files in
                  the current folder. Every action still asks first.
                </small>
              </span>
            </label>
          </section>
        )}

        {section === "editor" && (
          <section>
            <h3>Editor</h3>
            <div className="fm-field-grid">
              <label>
                Font family
                <input
                  value={settings.editor.fontFamily}
                  onChange={(e) =>
                    patch({ editor: { ...settings.editor, fontFamily: e.target.value } })
                  }
                />
              </label>
              <label>
                Font size
                <input
                  type="number"
                  min={8}
                  max={32}
                  value={settings.editor.fontSize}
                  onChange={(e) =>
                    patch({
                      editor: { ...settings.editor, fontSize: Number(e.target.value) || 13 },
                    })
                  }
                />
              </label>
              <label>
                Tab size
                <input
                  type="number"
                  min={1}
                  max={8}
                  value={settings.editor.tabSize}
                  onChange={(e) =>
                    patch({
                      editor: { ...settings.editor, tabSize: Number(e.target.value) || 2 },
                    })
                  }
                />
              </label>
            </div>
            {(
              [
                ["insertSpaces", "Insert spaces instead of tabs"],
                ["wordWrap", "Wrap long lines"],
                ["minimap", "Show minimap"],
                ["lineNumbers", "Show line numbers"],
                ["inlineSuggestions", "Inline suggestions as you type"],
                ["bracketPairColorization", "Colour matching brackets"],
                ["formatOnSave", "Format on save"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="fm-check">
                <input
                  type="checkbox"
                  checked={settings.editor[key]}
                  onChange={(e) =>
                    patch({ editor: { ...settings.editor, [key]: e.target.checked } })
                  }
                />
                <span>{label}</span>
              </label>
            ))}
          </section>
        )}

        {section === "appearance" && (
          <section>
            <h3>Theme</h3>
            <fieldset className="fm-themes">
              <legend className="fm-sr">Theme</legend>
              {THEME_LIST.map((t) => (
                <label key={t.id} className="fm-theme" data-on={settings.view.theme === t.id || undefined}>
                  <input
                    type="radio"
                    name="theme"
                    checked={settings.view.theme === t.id}
                    onChange={() => patch({ view: { ...settings.view, theme: t.id } })}
                  />
                  <span
                    className="fm-theme-chip"
                    aria-hidden
                    style={{ background: t.bg, borderColor: t.border }}
                  >
                    <i style={{ background: t.accent }} />
                    <i style={{ background: t.tones.code }} />
                    <i style={{ background: t.tones.image }} />
                    <i style={{ background: t.tones.archive }} />
                  </span>
                  <span className="fm-theme-text">
                    <strong>{t.name}</strong>
                    <small>{t.dark ? t.blurb : `Light. ${t.blurb}`}</small>
                  </span>
                </label>
              ))}
            </fieldset>
          </section>
        )}

        {section === "files" && (
          <section>
            <h3>Listing</h3>
            <div className="fm-field-grid">
              <label>
                Default view
                <select
                  value={settings.view.viewMode}
                  onChange={(e) =>
                    applyView({ viewMode: e.target.value as Settings["view"]["viewMode"] })
                  }
                >
                  <option value="details">Details</option>
                  <option value="icons">Icons</option>
                  <option value="compact">Compact</option>
                  <option value="tree">Tree</option>
                </select>
              </label>
              <label>
                Sort by
                <select
                  value={settings.view.sortBy}
                  onChange={(e) =>
                    applyView({ sortBy: e.target.value as Settings["view"]["sortBy"] })
                  }
                >
                  <option value="name">Name</option>
                  <option value="size">Size</option>
                  <option value="mtime">Modified</option>
                  <option value="category">Category</option>
                </select>
              </label>
              <label>
                Icon size
                <select
                  value={String(settings.view.iconSize)}
                  onChange={(e) => applyView({ iconSize: Number(e.target.value) || 34 })}
                >
                  <option value="24">Small</option>
                  <option value="34">Medium</option>
                  <option value="48">Large</option>
                </select>
              </label>
              <label>
                Start folder
                <input
                  placeholder="used when restore last is off"
                  value={settings.view.startPath ?? ""}
                  spellCheck={false}
                  onChange={(e) => applyView({ startPath: e.target.value || null })}
                />
              </label>
            </div>
            {(
              [
                ["showHidden", "Show hidden files"],
                ["dualPane", "Dual pane"],
                ["foldersFirst", "Keep folders above files"],
                ["sortDesc", "Sort descending"],
                ["confirmDelete", "Confirm before moving to trash"],
                ["singleClickOpen", "Open with a single click"],
                ["restoreLast", "Reopen last folders on start"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="fm-check">
                <input
                  type="checkbox"
                  checked={Boolean(settings.view[key])}
                  onChange={(e) => applyView({ [key]: e.target.checked })}
                />
                <span>{label}</span>
              </label>
            ))}
          </section>
        )}

        {section === "terminal" && (
          <section>
            <h3>Terminal</h3>
            <fieldset className="fm-docks">
              <legend>Position</legend>
              <p className="fm-hint">
                Bottom is the default. Right and top keep the file list full width or full height.
                Several tabs can be open at once. Press Alt for the Terminal menu.
              </p>
              <div className="fm-dock-options">
                {TERMINAL_DOCKS.map((d) => (
                  <label
                    key={d}
                    className="fm-check"
                    data-on={parseTerminalDock(settings.view.terminalDock) === d || undefined}
                  >
                    <input
                      type="radio"
                      name="terminalDock"
                      checked={parseTerminalDock(settings.view.terminalDock) === d}
                      onChange={() => applyView({ terminalDock: d })}
                    />
                    <span>{DOCK_LABEL[d]}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="fm-field">
              Shell
              <input
                placeholder="login shell ($SHELL)"
                value={settings.terminalShell ?? ""}
                onChange={(e) => patch({ terminalShell: e.target.value || null })}
              />
              <small className="fm-hint">
                Leave blank to use your login shell. The next new tab picks this up.
              </small>
            </label>
          </section>
        )}

        {section === "keyboard" && (
          <section>
            <h3>Shortcuts</h3>
            <p className="fm-hint">
              Press Alt by itself for File, View, Go and Terminal. These chords also work without
              opening the bar.
            </p>
            <dl className="fm-keys">
              <div>
                <dt>Ctrl + ,</dt>
                <dd>Settings</dd>
              </div>
              <div>
                <dt>Ctrl + Q</dt>
                <dd>Quit</dd>
              </div>
              <div>
                <dt>Ctrl + N</dt>
                <dd>New window</dd>
              </div>
              <div>
                <dt>Ctrl + S</dt>
                <dd>Save the open file</dd>
              </div>
              <div>
                <dt>Ctrl + L</dt>
                <dd>Edit the location bar</dd>
              </div>
              <div>
                <dt>Ctrl + I</dt>
                <dd>Filter this folder</dd>
              </div>
              <div>
                <dt>Ctrl + Z</dt>
                <dd>Undo last trash, rename or create</dd>
              </div>
              <div>
                <dt>F3</dt>
                <dd>Dual pane</dd>
              </div>
              <div>
                <dt>F4</dt>
                <dd>Terminal</dd>
              </div>
              <div>
                <dt>F10</dt>
                <dd>New folder</dd>
              </div>
              <div>
                <dt>Alt + Enter</dt>
                <dd>Properties</dd>
              </div>
              <div>
                <dt>Alt + .</dt>
                <dd>Show hidden files</dd>
              </div>
              <div>
                <dt>Alt + Left</dt>
                <dd>Back</dd>
              </div>
              <div>
                <dt>Alt + Right</dt>
                <dd>Forward</dd>
              </div>
              <div>
                <dt>Backspace</dt>
                <dd>Parent folder</dd>
              </div>
              <div>
                <dt>Ctrl + A</dt>
                <dd>Select all in the pane</dd>
              </div>
              <div>
                <dt>F2</dt>
                <dd>Rename</dd>
              </div>
              <div>
                <dt>Delete</dt>
                <dd>Move to trash</dd>
              </div>
              <div>
                <dt>Shift + Delete</dt>
                <dd>Delete permanently</dd>
              </div>
              <div>
                <dt>Escape</dt>
                <dd>Close settings or the menu</dd>
              </div>
            </dl>
          </section>
        )}
      </div>
    </div>
  );
}
