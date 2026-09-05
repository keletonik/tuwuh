/**
 * Properties for the current selection, including permission bits.
 *
 * Dolphin puts this behind Alt+Enter. chmod is explicit: flipping a box
 * writes the nine bits, it does not wait for a Save that can be missed.
 */
import { useEffect, useState } from "react";
import { chmodPath, dirSize, statPath, type Entry } from "@/lib/api";
import { useApp } from "@/lib/store";
import { formatBytes, formatMode, formatTime } from "@/lib/utils";
import { FileIcon, categoryLabel } from "./file-icon";

const BITS: { bit: number; label: string; group: string }[] = [
  { bit: 0o400, label: "Read", group: "Owner" },
  { bit: 0o200, label: "Write", group: "Owner" },
  { bit: 0o100, label: "Execute", group: "Owner" },
  { bit: 0o040, label: "Read", group: "Group" },
  { bit: 0o020, label: "Write", group: "Group" },
  { bit: 0o010, label: "Execute", group: "Group" },
  { bit: 0o004, label: "Read", group: "Other" },
  { bit: 0o002, label: "Write", group: "Other" },
  { bit: 0o001, label: "Execute", group: "Other" },
];

export function PropertiesDialog() {
  const path = useApp((s) => s.propertiesPath);
  const close = () => useApp.getState().setPropertiesPath(null);
  const toast = useApp((s) => s.toast);
  const [entry, setEntry] = useState<Entry | null>(null);
  const [recursive, setRecursive] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!path) return;
    let live = true;
    setEntry(null);
    setRecursive(null);
    statPath(path)
      .then((e) => live && setEntry(e))
      .catch((e) => toast("error", e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [path, toast]);

  if (!path) return null;

  const toggle = async (bit: number) => {
    if (!entry || busy) return;
    const next = entry.mode & bit ? entry.mode & ~bit : entry.mode | bit;
    setBusy(true);
    try {
      await chmodPath(entry.path, next & 0o7777);
      setEntry({ ...entry, mode: (entry.mode & ~0o777) | (next & 0o777) });
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fm-overlay" onMouseDown={close}>
      <div
        className="fm-props"
        role="dialog"
        aria-label="Properties"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="fm-settings-head">
          <h2>Properties</h2>
          <div>
            <button type="button" onClick={close}>
              Close
            </button>
          </div>
        </header>
        {!entry ? (
          <p className="fm-muted-line">Reading…</p>
        ) : (
          <div className="fm-settings-body">
            <header className="fm-info-head">
              <FileIcon entry={entry} size={28} />
              <div>
                <strong title={entry.path}>{entry.name}</strong>
                <small>{categoryLabel[entry.category]}</small>
              </div>
            </header>
            <dl className="fm-info-grid">
              <dt>Path</dt>
              <dd className="fm-path">{entry.path}</dd>
              <dt>Size</dt>
              <dd>
                {entry.kind === "dir" ? (
                  recursive === null ? (
                    <button
                      type="button"
                      className="fm-inline-btn"
                      onClick={() =>
                        void dirSize(entry.path).then(setRecursive).catch((e) => toast("error", e.message))
                      }
                    >
                      Calculate
                    </button>
                  ) : (
                    formatBytes(recursive)
                  )
                ) : (
                  formatBytes(entry.size)
                )}
              </dd>
              <dt>Modified</dt>
              <dd>{formatTime(entry.mtime)}</dd>
              <dt>Permissions</dt>
              <dd className="fm-mono">{formatMode(entry.mode)}</dd>
              {entry.mime && (
                <>
                  <dt>Type</dt>
                  <dd>{entry.mime}</dd>
                </>
              )}
              {entry.symlinkTarget && (
                <>
                  <dt>Links to</dt>
                  <dd className="fm-path">{entry.symlinkTarget}</dd>
                </>
              )}
            </dl>
            <h3>Access</h3>
            <div className="fm-chmod">
              {(["Owner", "Group", "Other"] as const).map((group) => (
                <fieldset key={group}>
                  <legend>{group}</legend>
                  {BITS.filter((b) => b.group === group).map((b) => (
                    <label key={b.bit}>
                      <input
                        type="checkbox"
                        checked={Boolean(entry.mode & b.bit)}
                        disabled={busy}
                        onChange={() => void toggle(b.bit)}
                      />
                      {b.label}
                    </label>
                  ))}
                </fieldset>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
