/**
 * Places sidebar: XDG user directories, bookmarks and the filesystem root.
 *
 * The backend only returns directories that exist, so a machine without a
 * `~/Videos` does not get a shortcut that fails when clicked.
 */
import { useEffect, useState } from "react";
import {
  Bookmark,
  BookmarkMinus,
  Download,
  FileText,
  HardDrive,
  Home,
  Image,
  Monitor,
  Music,
  Trash2,
  Usb,
  Video,
  type LucideIcon,
} from "lucide-react";
import { basename, emptyTrash, listMounts, places, saveSettings, type Mount, type Place } from "@/lib/api";
import { useApp } from "@/lib/store";

const ICONS: Record<string, LucideIcon> = {
  home: Home,
  monitor: Monitor,
  "file-text": FileText,
  download: Download,
  music: Music,
  image: Image,
  video: Video,
  "hard-drive": HardDrive,
};

export function Sidebar() {
  const navigate = useApp((s) => s.navigate);
  const activePane = useApp((s) => s.activePane);
  const cwd = useApp((s) => s.panes[s.activePane].cwd);
  const settings = useApp((s) => s.settings);
  const setSettings = useApp((s) => s.setSettings);
  const toast = useApp((s) => s.toast);
  const [list, setList] = useState<Place[]>([]);
  const [mounts, setMounts] = useState<Mount[]>([]);
  const special = useApp((s) => s.panes[s.activePane].special);

  useEffect(() => {
    places()
      .then(setList)
      .catch((e) => toast("error", e.message));
    listMounts()
      .then(setMounts)
      .catch(() => undefined);
  }, [toast]);

  if (!settings) return null;
  const bookmarked = settings.bookmarks.includes(cwd);

  const toggleBookmark = async () => {
    const bookmarks = bookmarked
      ? settings.bookmarks.filter((b) => b !== cwd)
      : [...settings.bookmarks, cwd];
    const next = { ...settings, bookmarks };
    setSettings(next);
    try {
      await saveSettings(next);
    } catch (e) {
      // Roll the optimistic update back rather than showing a bookmark that
      // will be gone at the next start.
      setSettings(settings);
      toast("error", e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <aside className="fm-sidebar">
      <h2 className="fm-sidebar-title">Places</h2>
      <nav>
        {list.map((p) => {
          const Icon = ICONS[p.icon] ?? HardDrive;
          return (
            <button
              key={p.path}
              type="button"
              data-current={cwd === p.path || undefined}
              onClick={() => void navigate(activePane, p.path)}
              title={p.path}
            >
              <Icon size={15} />
              <span>{p.label}</span>
            </button>
          );
        })}
      </nav>

      <h2 className="fm-sidebar-title">
        <span>Trash</span>
        <button
          type="button"
          className="fm-bookmark-toggle"
          title="Empty trash"
          aria-label="Empty trash"
          onClick={() => {
            if (!window.confirm("Permanently empty the trash?")) return;
            void emptyTrash()
              .then(() => useApp.getState().loadTrash())
              .then(() => toast("success", "Trash emptied."))
              .catch((e) => toast("error", e instanceof Error ? e.message : String(e)));
          }}
        >
          <Trash2 size={14} />
        </button>
      </h2>
      <nav>
        <button
          type="button"
          data-current={special === "trash" || undefined}
          onClick={() => void useApp.getState().openTrash(activePane)}
        >
          <Trash2 size={15} />
          <span>Trash</span>
        </button>
      </nav>

      {mounts.length > 0 && (
        <>
          <h2 className="fm-sidebar-title">Devices</h2>
          <nav>
            {mounts.map((m) => (
              <button
                key={m.path}
                type="button"
                data-current={cwd === m.path || undefined}
                onClick={() => void navigate(activePane, m.path)}
                title={`${m.path} (${m.fs})`}
              >
                <Usb size={15} />
                <span>{m.label}</span>
              </button>
            ))}
          </nav>
        </>
      )}

      <h2 className="fm-sidebar-title">
        Bookmarks
        <button
          type="button"
          className="fm-bookmark-toggle"
          onClick={() => void toggleBookmark()}
          title={bookmarked ? `Remove bookmark for ${cwd}` : `Bookmark ${cwd}`}
          aria-label={bookmarked ? "Remove bookmark" : "Add bookmark"}
        >
          {bookmarked ? <BookmarkMinus size={14} /> : <Bookmark size={14} />}
        </button>
      </h2>
      <nav>
        {settings.bookmarks.length === 0 && (
          <p className="fm-muted-line fm-sidebar-empty">None yet.</p>
        )}
        {settings.bookmarks.map((b) => (
          <button
            key={b}
            type="button"
            data-current={cwd === b || undefined}
            onClick={() => void navigate(activePane, b)}
            title={b}
          >
            <Bookmark size={15} />
            <span>{basename(b)}</span>
          </button>
        ))}
      </nav>
    </aside>
  );
}
