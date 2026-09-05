import { useEffect, useState } from "react";
import { getSettings, homeDir, onFsChanged } from "@/lib/api";
import { useApp } from "@/lib/store";
import { applyTheme } from "@/lib/apply-theme";
import { Workbench } from "@/components/workbench";
import { Keymap } from "@/components/keymap";

export default function App() {
  const ready = useApp((s) => s.ready);
  const boot = useApp((s) => s.boot);
  const theme = useApp((s) => s.settings?.view.theme);
  const [fatal, setFatal] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [home, settings] = await Promise.all([homeDir(), getSettings()]);
        await boot(home, settings);
      } catch (e) {
        // Failing to read HOME or the settings file is not recoverable from
        // inside the app, so say what went wrong rather than showing an empty
        // window forever.
        setFatal(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [boot]);

  useEffect(() => {
    if (theme) applyTheme(theme);
  }, [theme]);

  /* One listener for the whole app: the backend names the directory that
     changed and the store refreshes whichever panes are showing it. */
  useEffect(() => {
    let off: (() => void) | undefined;
    void onFsChanged((path) => void useApp.getState().refreshPath(path)).then((fn) => {
      off = fn;
    });
    return () => off?.();
  }, []);

  if (fatal) {
    return (
      <div className="fm-fatal">
        <h1>Tuwuh could not start</h1>
        <p>{fatal}</p>
      </div>
    );
  }

  if (!ready) return <div className="fm-fatal fm-boot">Starting…</div>;

  return (
    <>
      <Keymap />
      <Workbench />
    </>
  );
}
