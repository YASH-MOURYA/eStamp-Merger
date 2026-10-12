import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()], // enables the React JSX transform (App.jsx has no `import React`)
  server: {
    host: true,         // reachable from Codespaces / LAN
    allowedHosts: true, // dev server only
  },
  build: { target: "esnext", chunkSizeWarningLimit: 1500 },
  optimizeDeps: { esbuildOptions: { target: "esnext" } },
});
