import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(here, "src"),
    },
  },
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      // `ws: true` so the `/battle/ws/{room_code}` WebSocket upgrade is
      // forwarded to FastAPI on 8080. The string target above doesn't enable
      // websocket forwarding, so the object form is required here.
      "/battle": {
        target: "http://localhost:8080",
        changeOrigin: true,
        ws: true,
      },
      "/analyze": "http://localhost:8080",
      "/attempts": "http://localhost:8080",
      "/interview": "http://localhost:8080",
      "/auth": "http://localhost:8080",
    },
  },
});
