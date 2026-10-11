import fs from "node:fs";
import path from "node:path";
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const CESIUM_SRC = path.resolve(__dirname, "node_modules/cesium/Build/Cesium");
const CESIUM_DIRS = ["Workers", "ThirdParty", "Assets", "Widgets"];

/**
 * CesiumJS loads web workers and static assets at runtime from CESIUM_BASE_URL (/cesium).
 * Dev: serve them straight from node_modules. Build: copy them into dist/cesium.
 */
function cesiumAssets(): Plugin {
  return {
    name: "landview-cesium-assets",
    configureServer(server) {
      server.middlewares.use("/cesium", (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? "/").split("?")[0]);
        const file = path.join(CESIUM_SRC, rel);
        if (!file.startsWith(CESIUM_SRC) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return next();
        fs.createReadStream(file).pipe(res);
      });
    },
    closeBundle() {
      const out = path.resolve(__dirname, "dist/cesium");
      for (const d of CESIUM_DIRS) fs.cpSync(path.join(CESIUM_SRC, d), path.join(out, d), { recursive: true });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react(), tailwindcss(), cesiumAssets()],
    resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
    define: { CESIUM_BASE_URL: JSON.stringify("/cesium") },
    server: {
      port: 5173,
      // Dev: /api/* is forwarded to the FastAPI backend
      proxy: { "/api": { target: env.VITE_DEV_PROXY_TARGET || "http://localhost:8000", changeOrigin: true } },
    },
  };
});
