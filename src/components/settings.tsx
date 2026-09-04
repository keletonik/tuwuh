/**
 * Settings, including the AI provider configuration.
 *
 * API keys are write-only from here. They go straight to the OS keyring in the
 * backend and there is no command that reads one back, so this screen can tell
 * you a key is configured but can never show it. That is deliberate: the
 * webview is the part most likely to leak a secret through a log or a crash
 * report, so it never holds one.
 */
import { useCallback, useEffect, useState } from "react";
import { Check, KeyRound, Trash2, TriangleAlert } from "lucide-react";
import {
  deleteProviderKey,
  providerStatus,
  saveSettings,
  setProviderKey,
  type ProviderId,
  type ProviderStatus,
  type Settings,
} from "@/lib/api";
import { useApp } from "@/lib/store";
import { THEME_LIST } from "@/lib/themes";

const PROVIDER_LABEL: Record<ProviderId, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  xai: "xAI",
  openrouter: "OpenRouter",
  ollama: "Ollama (local)",
};

export function SettingsPanel() {
  const settings = useApp((s) => s.settings);
  const setSettings = useApp((s) => s.setSettings);
  const setOpen = useApp((s) => s.setSettingsOpen);
  const toast = useApp((s) => s.toast);
  const refresh = useApp((s) => s.refresh);

  const [status, setStatus] = useState<ProviderStatus[]>([]);
  const [keyDraft, setKeyDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const reloadStatus = useCallback(() => {
    providerStatus()
      .then(setStatus)
      .catch((e) => toast("error", e.message));
  }, [toast]);

  useEffect(reloadStatus, [reloadStatus]);

  if (!settings) return null;

  const patch = (p: Partial<Settings>) => setSettings({ ...settings, ...p });

  const persist = async () => {
    setSaving(true);
    try {
      await saveSettings(settings);
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
      // Clear the draft the moment it is stored so the key does not sit in
      // React state for the life of the window.
      setKeyDraft((d) => ({ ...d, [provider]: "" }));
      reloadStatus();
      toast("success", `${PROVIDER_LABEL[provider]} key saved to the keyring.`);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    }
  };

  const removeKey = async (provider: ProviderId) => {
    try {
      await deleteProviderKey(provider);
      reloadStatus();
      toast("success", `${PROVIDER_LABEL[provider]} key removed.`);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="fm-settings" role="dialog" aria-label="Settings">
      <header className="fm-settings-head">
        <h2>Settings</h2>
        <div>
          <button type="button" onClick={() => void persist()} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
          <button type="button" onClick={() => setOpen(false)}>
            Close
          </button>
        </div>
      </header>

      <div className="fm-settings-body">
        <section>
          <h3>AI providers</h3>
          <p className="fm-hint">
            Keys are stored in your OS keyring, never in the settings file and never in the
            window. Requests are made from the backend.
          </p>

          {status.map((s) => {
            const id = s.provider;
            return (
              <div key={id} className="fm-provider">
                <div className="fm-provider-head">
                  <label>
                    <input
                      type="radio"
                      name="provider"
                      checked={settings.ai.provider === id}
                      onChange={() =>
                        patch({
                          ai: { ...settings.ai, provider: id, model: s.defaultModel },
                        })
                      }
                    />
                    <strong>{PROVIDER_LABEL[id]}</strong>
                  </label>
                  {s.needsKey ? (
                    <span className="fm-badge" data-ok={s.hasKey || undefined}>
                      {s.hasKey ? (
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

                {s.needsKey && (
                  <div className="fm-provider-key">
                    <KeyRound size={14} />
                    <input
                      type="password"
                      autoComplete="off"
                      spellCheck={false}
                      placeholder={s.hasKey ? "Replace stored key" : `${PROVIDER_LABEL[id]} API key`}
                      value={keyDraft[id] ?? ""}
                      onChange={(e) => setKeyDraft((d) => ({ ...d, [id]: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void saveKey(id);
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => void saveKey(id)}
                      disabled={!(keyDraft[id] ?? "").trim()}
                    >
                      Store
                    </button>
                    {s.hasKey && (
                      <button
                        type="button"
                        aria-label={`Remove ${PROVIDER_LABEL[id]} key`}
                        onClick={() => void removeKey(id)}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          <div className="fm-field-grid">
            <label>
              Model
              <input
                value={settings.ai.model}
                onChange={(e) => patch({ ai: { ...settings.ai, model: e.target.value } })}
              />
            </label>
            <label>
              Base URL override
              <input
                placeholder="provider default"
                value={settings.ai.baseUrl ?? ""}
                onChange={(e) =>
                  patch({ ai: { ...settings.ai, baseUrl: e.target.value || null } })
                }
              />
            </label>
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
                  patch({ editor: { ...settings.editor, tabSize: Number(e.target.value) || 2 } })
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

        <section>
          <h3>Appearance and behaviour</h3>
          <fieldset className="fm-themes">
            <legend>Theme</legend>
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

          {(
            [
              ["showHidden", "Show hidden files"],
              ["dualPane", "Dual pane"],
              ["confirmDelete", "Confirm before moving to trash"],
              ["singleClickOpen", "Open with a single click"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="fm-check">
              <input
                type="checkbox"
                checked={settings.view[key]}
                onChange={(e) => patch({ view: { ...settings.view, [key]: e.target.checked } })}
              />
              <span>{label}</span>
            </label>
          ))}
        </section>
      </div>
    </div>
  );
}

