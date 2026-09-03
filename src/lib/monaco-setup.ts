/**
 * Bundle Monaco instead of fetching it.
 *
 * `@monaco-editor/react` defaults to loading the editor from jsdelivr at
 * runtime. In a packaged desktop app that fails twice over: the content
 * security policy allows scripts from 'self' only, and the app has to work
 * with no network at all. Pointing the loader at the local package fixes both,
 * and the language workers have to be wired explicitly for the same reason, or
 * syntax services fall back to running on the main thread.
 */
import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/language/json/json.worker?worker";
import cssWorker from "monaco-editor/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/language/html/html.worker?worker";
import tsWorker from "monaco-editor/language/typescript/ts.worker?worker";

declare global {
  interface Window {
    MonacoEnvironment?: monaco.Environment;
  }
}

window.MonacoEnvironment = {
  getWorker(_moduleId: string, label: string) {
    switch (label) {
      case "json":
        return new jsonWorker();
      case "css":
      case "scss":
      case "less":
        return new cssWorker();
      case "html":
      case "handlebars":
      case "razor":
        return new htmlWorker();
      case "typescript":
      case "javascript":
        return new tsWorker();
      default:
        return new editorWorker();
    }
  },
};

loader.config({ monaco });
