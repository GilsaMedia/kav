import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `npm run dev` serves the app with hot reload; the API and map come from `npm start` on :8443.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    proxy: {
      "/api": { target: "https://localhost:8443", secure: false },
      "/map": { target: "https://localhost:8443", secure: false },
    },
  },
  build: { outDir: "dist", chunkSizeWarningLimit: 2000 },
});
