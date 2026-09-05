/**
 * Layout gate for terminal docking.
 *
 * Imports the same helpers the workbench uses, so a change that makes every
 * dock render as bottom cannot pass. This is a behaviour check, not a claim
 * that the panel tree in workbench.tsx is wired; that is verified by reading
 * the slot() call sites and by a screenshot of each dock.
 *
 *   node scripts/check-layout.mjs
 */
import { parseTerminalDock, terminalSlot, TERMINAL_DOCKS } from "../src/lib/layout.ts";

const cases = [
  { input: undefined, dock: "bottom", slot: "vertical-end" },
  { input: null, dock: "bottom", slot: "vertical-end" },
  { input: "", dock: "bottom", slot: "vertical-end" },
  { input: "left", dock: "bottom", slot: "vertical-end" },
  { input: "TOP", dock: "bottom", slot: "vertical-end" },
  { input: "top", dock: "top", slot: "vertical-start" },
  { input: "right", dock: "right", slot: "horizontal-end" },
  { input: "bottom", dock: "bottom", slot: "vertical-end" },
];

let failed = 0;
for (const c of cases) {
  const dock = parseTerminalDock(c.input);
  const slot = terminalSlot(dock);
  if (dock !== c.dock || slot !== c.slot) {
    failed += 1;
    console.log(
      `FAIL parse(${JSON.stringify(c.input)}) -> dock=${dock} slot=${slot}; ` +
        `want dock=${c.dock} slot=${c.slot}`,
    );
  }
}

for (const dock of TERMINAL_DOCKS) {
  if (parseTerminalDock(dock) !== dock) {
    failed += 1;
    console.log(`FAIL identity ${dock}`);
  }
}

// Distinct docks must produce distinct slots, or the settings radios are a lie.
const slots = new Set(TERMINAL_DOCKS.map(terminalSlot));
if (slots.size !== TERMINAL_DOCKS.length) {
  failed += 1;
  console.log(`FAIL slots collapsed: ${[...slots].join(",")}`);
}

if (failed) {
  console.log(`${failed} layout check(s) failed`);
  process.exit(1);
}
console.log(`ok   layout  ${cases.length} cases, ${TERMINAL_DOCKS.length} docks`);
