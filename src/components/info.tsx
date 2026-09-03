/**
 * Information about the current selection.
 *
 * Directory sizes and image previews are both expensive, so neither is fetched
 * until something is actually selected, and both are cancelled when the
 * selection moves on. A stale preview belonging to the previous file is worse
 * than no preview.
 */
import { useEffect, useState } from "react";
import { dirSize, readPreview, statPath, type Entry } from "@/lib/api";
import { useApp } from "@/lib/store";
import { formatBytes, formatMode, formatTime } from "@/lib/utils";
import { FileIcon, categoryLabel } from "./file-icon";

export function InfoPanel() {
  const pane = useApp((s) => s.panes[s.activePane]);
  const [entry, setEntry] = useState<Entry | null>(null);
  const [recursive, setRecursive] = useState<number | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const target = pane.selected[pane.selected.length - 1] ?? pane.cwd;

  useEffect(() => {
    let live = true;
    setEntry(null);
    setRecursive(null);
    setPreview(null);

    statPath(target)
      .then((e) => {
        if (!live) return;
        setEntry(e);
        if (e.category === "image") {
          readPreview(e.path)
            .then((d) => live && setPreview(d))
            .catch(() => undefined);
        }
      })
      .catch(() => undefined);

    // `live` guards every setter: a slow dir_size on a large tree would
    // otherwise land after the user has already selected something else.
    return () => {
      live = false;
    };
  }, [target]);

  if (!entry) {
    return (
      <aside className="fm-info">
        <p className="fm-muted-line">Nothing selected.</p>
      </aside>
    );
  }

  return (
    <aside className="fm-info" aria-label="Information">
      <header className="fm-info-head">
        <FileIcon entry={entry} size={28} />
        <div>
          <strong title={entry.path}>{entry.name}</strong>
          <small>{categoryLabel[entry.category]}</small>
        </div>
      </header>

      {preview && <img className="fm-preview" src={preview} alt={`Preview of ${entry.name}`} />}

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
                onClick={() => void dirSize(entry.path).then(setRecursive).catch(() => undefined)}
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

        {entry.childCount !== null && (
          <>
            <dt>Contains</dt>
            <dd>
              {entry.childCount} item{entry.childCount === 1 ? "" : "s"}
            </dd>
          </>
        )}

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

      {pane.selected.length > 1 && (
        <p className="fm-muted-line">{pane.selected.length} items selected.</p>
      )}
    </aside>
  );
}
