import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  // Tauri points at this port in tauri.conf.json; a silent fallback to another
  // port would leave the desktop window loading nothing.
  server: { port: 5173, strictPort: true },
  build: {
    target: "esnext",
    sourcemap: false,
    // Monaco is the VS Code editor core: a multi-megabyte chunk is expected,
    // and this is a local desktop bundle, not something served over a network.
    chunkSizeWarningLimit: 8000,
    rollupOptions: {
      output: {
        // Monaco is far larger than the rest of the app put together. Splitting
        // it keeps the first paint off the critical path of that bundle.
        manualChunks(id: string) {
          if (id.includes("monaco-editor")) return "monaco";
          if (id.includes("@xterm")) return "xterm";
          return undefined;
        },
      },
    },
  },
});
