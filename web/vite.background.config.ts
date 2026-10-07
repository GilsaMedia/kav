import { defineConfig } from "vite";

// The background check (backend/background.ts) as one plain script, kav-bg.js, next to the app in dist/:
// the iPhone app runs it in JavaScriptCore when iOS wakes Kav in the background.
export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: false,
    copyPublicDir: false,
    lib: { entry: "backend/background.ts", formats: ["iife"], name: "KavBackground", fileName: () => "kav-bg.js" },
  },
});
