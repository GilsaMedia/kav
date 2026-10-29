import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

const version = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version;

// `npm run dev` serves the app with hot reload; the API and map come from `npm start` on :8443.
export default defineConfig({
  plugins: [react()],
  // The app's version, for the feedback forms in Settings.
  define: { __KAV_VERSION__: JSON.stringify(version) },
  server: {
    host: true,
    proxy: {
      "/api": { target: "https://localhost:8443", secure: false },
      "/map": { target: "https://localhost:8443", secure: false },
    },
  },
  build: { outDir: "dist", chunkSizeWarningLimit: 2000 },
});
