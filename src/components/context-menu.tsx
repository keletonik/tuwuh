/**
 * A right-click menu that stays inside the window.
 *
 * Positioning is corrected after mount rather than guessed: a menu opened near
 * the bottom or right edge would otherwise render partly off-screen, which is
 * exactly where a right-click on the last row in a list puts it.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";

export type MenuItem =
  | { separator: true }
  | {
      separator?: false;
      label: string;
      shortcut?: string;
      disabled?: boolean;
      danger?: boolean;
      onSelect: () => void;
    };

export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      x: Math.max(4, Math.min(x, window.innerWidth - width - 4)),
      y: Math.max(4, Math.min(y, window.innerHeight - height - 4)),
    });
  }, [x, y]);

  useEffect(() => {
    const close = () => onClose();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // Capture phase: a click that opens another menu must close this one first.
    window.addEventListener("mousedown", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="fm-menu"
      role="menu"
      style={{ left: pos.x, top: pos.y }}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) =>
        item.separator ? (
          <hr key={`sep-${i}`} className="fm-menu-sep" />
        ) : (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            data-danger={item.danger || undefined}
            onClick={() => {
              item.onSelect();
              onClose();
            }}
          >
            <span>{item.label}</span>
            {item.shortcut && <kbd>{item.shortcut}</kbd>}
          </button>
        ),
      )}
    </div>
  );
}
