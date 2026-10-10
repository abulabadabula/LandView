import path from "node:path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react(), tailwindcss()],
    resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
    server: {
      port: 5173,
      // Dev: /api/* is forwarded to the FastAPI backend
      proxy: { "/api": { target: env.VITE_DEV_PROXY_TARGET || "http://localhost:8000", changeOrigin: true } },
    },
  };
});
