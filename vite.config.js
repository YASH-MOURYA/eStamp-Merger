import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()], // enables the React JSX transform
  server: {
    host: true,         // reachable from Codespaces / LAN
    allowedHosts: true, // dev server only
  },
  build: {
    target: "esnext",
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        // The PDF.js worker is emitted as ".mjs". Some static hosts send ".mjs" with the wrong MIME type, which
        // silently breaks the preview. Emitting it as ".js" works on every host (Netlify, Vercel, GitHub Pages ...).
        assetFileNames: (asset) =>
          (asset.names?.[0] ?? asset.name ?? "").endsWith(".mjs") ? "assets/[name]-[hash].js" : "assets/[name]-[hash][extname]",
      },
    },
  },
  optimizeDeps: { esbuildOptions: { target: "esnext" } },
});
