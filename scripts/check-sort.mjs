/**
 * Sort gate. Folders-first and a descending reverse must not dump directories
 * under files, and turning folders-first off must interleave.
 */
import { sortEntries } from "../src/lib/sort.ts";

const sample = [
  { path: "/b", name: "b.txt", kind: "file", size: 2, mtime: 2, category: "document" },
  { path: "/a", name: "a", kind: "dir", size: 0, mtime: 1, category: "folder" },
  { path: "/c", name: "c.txt", kind: "file", size: 1, mtime: 3, category: "code" },
  { path: "/d", name: "d", kind: "dir", size: 0, mtime: 4, category: "folder" },
];

let failed = 0;
const fail = (m) => {
  failed += 1;
  console.log(`FAIL ${m}`);
};

const names = (rows) => rows.map((r) => r.name).join(",");

const lead = sortEntries(sample, "name", false, true);
if (names(lead) !== "a,d,b.txt,c.txt") fail(`folders first name: ${names(lead)}`);

const desc = sortEntries(sample, "name", true, true);
if (desc[0].kind !== "dir" || desc.at(-1).kind !== "file") {
  fail(`desc dumped a file above a folder: ${names(desc)}`);
}

const mixed = sortEntries(sample, "name", false, false);
if (mixed[0].kind === "dir" && mixed[1].kind === "dir") {
  fail(`foldersFirst false still grouped directories: ${names(mixed)}`);
}
if (names(mixed) !== "a,b.txt,c.txt,d") fail(`interleave name: ${names(mixed)}`);

if (failed) {
  console.log(`${failed} sort check(s) failed`);
  process.exit(1);
}
console.log("ok   sort    folders-first and interleaved");
