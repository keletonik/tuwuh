/**
 * The assistant panel.
 *
 * The model is given the current folder as context and can propose file
 * operations, but it never performs one. Proposals come back in a fenced
 * `tuwuh` block, are parsed here, and are shown as buttons the user presses.
 * A model that could delete files on its own say-so is not a feature, it is an
 * outage waiting for a bad completion, so the confirmation is not optional and
 * cannot be turned off from the settings screen.
 */
import { useCallback, useRef, useState } from "react";
import { Bot, CornerDownLeft, Play, Trash2 } from "lucide-react";
import {
  aiChat,
  createDir,
  createFile,
  joinPath,
  movePath,
  renamePath,
  trashPaths,
  type ChatMessage,
} from "@/lib/api";
import { useApp } from "@/lib/store";
import { formatBytes } from "@/lib/utils";

type Action =
  | { op: "createDir"; name: string }
  | { op: "createFile"; name: string }
  | { op: "rename"; from: string; to: string }
  | { op: "move"; from: string; toDir: string }
  | { op: "trash"; paths: string[] };

interface Turn {
  role: "user" | "assistant";
  text: string;
  actions?: Action[];
  error?: boolean;
}

const SYSTEM = `You help manage files in a desktop file manager.
Answer briefly and concretely about the folder you are shown.

If, and only if, the user asks you to change something, end your reply with a
fenced block tagged tuwuh containing a JSON array of actions. Supported shapes:
  {"op":"createDir","name":"NAME"}
  {"op":"createFile","name":"NAME"}
  {"op":"rename","from":"ABSOLUTE_PATH","to":"NEW_NAME"}
  {"op":"move","from":"ABSOLUTE_PATH","toDir":"ABSOLUTE_DIR"}
  {"op":"trash","paths":["ABSOLUTE_PATH"]}
Propose nothing you were not asked for. The user confirms every action before it
runs, so never claim an action has already happened.`;

/** Pull the proposal block out of a reply and return it with the prose. */
function splitActions(text: string): { prose: string; actions: Action[] } {
  const fence = /```tuwuh\s*([\s\S]*?)```/i.exec(text);
  if (!fence) return { prose: text.trim(), actions: [] };
  let actions: Action[] = [];
  try {
    const parsed = JSON.parse(fence[1].trim());
    // A malformed proposal must not take the whole reply down: the prose is
    // still worth showing.
    if (Array.isArray(parsed)) actions = parsed.filter((a) => a && typeof a.op === "string");
  } catch {
    actions = [];
  }
  return { prose: text.replace(fence[0], "").trim(), actions };
}

function describe(a: Action, cwd: string): string {
  switch (a.op) {
    case "createDir":
      return `Create folder ${a.name} in ${cwd}`;
    case "createFile":
      return `Create file ${a.name} in ${cwd}`;
    case "rename":
      return `Rename ${a.from} to ${a.to}`;
    case "move":
      return `Move ${a.from} into ${a.toDir}`;
    case "trash":
      return `Move to trash: ${a.paths.join(", ")}`;
  }
}

export function Assistant() {
  const settings = useApp((s) => s.settings);
  const pane = useApp((s) => s.panes[s.activePane]);
  const refresh = useApp((s) => s.refresh);
  const toast = useApp((s) => s.toast);
  const setOpen = useApp((s) => s.setAssistantOpen);

  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    setTurns((t) => [...t, { role: "user", text }]);
    setBusy(true);

    // Context is a listing, not file contents: sending every file in a folder
    // to a provider is neither affordable nor something the user asked for.
    const listing = pane.entries
      .slice(0, 200)
      .map(
        (e) =>
          `${e.kind === "dir" ? "d" : "-"} ${e.name}${e.kind === "file" ? ` (${formatBytes(e.size)}, ${e.category})` : ""}`,
      )
      .join("\n");
    const context = `Current folder: ${pane.cwd}\nSelected: ${pane.selected.join(", ") || "nothing"}\nContents (${pane.entries.length} items${pane.entries.length > 200 ? ", first 200 shown" : ""}):\n${listing}`;

    const history: ChatMessage[] = [
      ...turns.map((t) => ({ role: t.role, content: t.text }) as ChatMessage),
      { role: "user", content: `${context}\n\n---\n\n${text}` },
    ];

    try {
      const reply = await aiChat(
        history,
        SYSTEM,
        settings?.ai.provider,
        settings?.ai.model,
      );
      const { prose, actions } = splitActions(reply.text);
      setTurns((t) => [
        ...t,
        {
          role: "assistant",
          text: prose || "(no text in the reply)",
          actions: settings?.ai.allowFileActions ? actions : undefined,
        },
      ]);
      if (actions.length && !settings?.ai.allowFileActions) {
        toast(
          "info",
          "The assistant proposed file changes. Turn on file operations in Settings to act on them.",
        );
      }
    } catch (e) {
      setTurns((t) => [
        ...t,
        { role: "assistant", text: e instanceof Error ? e.message : String(e), error: true },
      ]);
    } finally {
      setBusy(false);
      requestAnimationFrame(() =>
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }),
      );
    }
  }, [draft, busy, pane, turns, settings, toast]);

  const run = useCallback(
    async (a: Action) => {
      if (!window.confirm(`${describe(a, pane.cwd)}?`)) return;
      try {
        switch (a.op) {
          case "createDir":
            await createDir(joinPath(pane.cwd, a.name));
            break;
          case "createFile":
            await createFile(joinPath(pane.cwd, a.name));
            break;
          case "rename":
            await renamePath(a.from, joinPath(pane.cwd, a.to));
            break;
          case "move":
            await movePath(a.from, a.toDir);
            break;
          case "trash":
            await trashPaths(a.paths);
            break;
        }
        await refresh();
        toast("success", "Done.");
      } catch (e) {
        toast("error", e instanceof Error ? e.message : String(e));
      }
    },
    [pane.cwd, refresh, toast],
  );

  return (
    <aside className="fm-assistant" aria-label="Assistant">
      <header className="fm-assistant-head">
        <span>
          <Bot size={15} /> Assistant
          <small>
            {settings?.ai.provider}
            {settings?.ai.model ? ` · ${settings.ai.model}` : ""}
          </small>
        </span>
        <div>
          <button type="button" aria-label="Clear conversation" onClick={() => setTurns([])}>
            <Trash2 size={14} />
          </button>
          <button type="button" onClick={() => setOpen(false)}>
            Close
          </button>
        </div>
      </header>

      <div className="fm-assistant-log" ref={scrollRef}>
        {turns.length === 0 && (
          <p className="fm-muted-line">
            Ask about this folder. It sees the listing of {pane.cwd}, not file contents.
          </p>
        )}
        {turns.map((t, i) => (
          <div key={i} className="fm-turn" data-role={t.role} data-error={t.error || undefined}>
            <p>{t.text}</p>
            {t.actions?.map((a, j) => (
              <button key={j} type="button" className="fm-action" onClick={() => void run(a)}>
                <Play size={12} /> {describe(a, pane.cwd)}
              </button>
            ))}
          </div>
        ))}
        {busy && <p className="fm-muted-line">Thinking…</p>}
      </div>

      <form
        className="fm-assistant-input"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ask about this folder"
          rows={2}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button type="submit" disabled={busy || !draft.trim()} aria-label="Send">
          <CornerDownLeft size={14} />
        </button>
      </form>
    </aside>
  );
}
