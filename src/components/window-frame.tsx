/**
 * Client-side window frame: a visible border, eight resize edges, and the
 * min/max/close cluster. Native GTK decorations are off because they often
 * fail to appear on Wayland, leaving a window that cannot be moved or sized.
 */
import { useEffect, useState } from "react";
import { Maximize2, Minus, Square, X } from "lucide-react";
import {
  onWindowResized,
  RESIZE_EDGES,
  windowClose,
  windowIsMaximized,
  windowMinimize,
  windowStartDrag,
  windowStartResize,
  windowToggleMaximize,
} from "@/lib/window";

export function WindowResizeEdges({ maximized }: { maximized: boolean }) {
  if (maximized) return null;
  return (
    <>
      {RESIZE_EDGES.map((edge) => (
        <div
          key={edge}
          className={`fm-win-edge fm-win-edge-${edge}`}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void windowStartResize(edge);
          }}
        />
      ))}
    </>
  );
}

export function WindowControls() {
  return (
    <div className="fm-win-btns" data-no-drag>
      <button type="button" aria-label="Minimise" onClick={() => void windowMinimize()}>
        <Minus size={14} />
      </button>
      <MaximizeButton />
      <button
        type="button"
        aria-label="Close"
        className="fm-win-close"
        onClick={() => void windowClose()}
      >
        <X size={14} />
      </button>
    </div>
  );
}

export function useMaximized() {
  const [max, setMax] = useState(false);
  useEffect(() => {
    let live = true;
    let off: (() => void) | undefined;
    void windowIsMaximized().then((v) => {
      if (live) setMax(v);
    });
    void onWindowResized(() => {
      void windowIsMaximized().then((v) => {
        if (live) setMax(v);
      });
    }).then((fn) => {
      if (!live) {
        fn();
        return;
      }
      off = fn;
    });
    return () => {
      live = false;
      off?.();
    };
  }, []);
  return max;
}

function MaximizeButton() {
  const max = useMaximized();
  return (
    <button
      type="button"
      aria-label={max ? "Restore" : "Maximise"}
      onClick={() => void windowToggleMaximize()}
    >
      {max ? <Square size={12} /> : <Maximize2 size={13} />}
    </button>
  );
}

export function dragChrome(e: React.MouseEvent) {
  if (e.button !== 0) return;
  const t = e.target as HTMLElement;
  if (t.closest("button, input, a, select, textarea, [data-no-drag]")) return;
  void windowStartDrag();
}
