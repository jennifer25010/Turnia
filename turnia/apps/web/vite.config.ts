import { resolve } from "node:path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => {
  const envDir = resolve(process.cwd(), "../..");
  const env = loadEnv(mode, envDir, "");
  const apiPort = Number(env.API_PORT) || 3000;

  return {
    envDir,
    plugins: [react(), tailwindcss()],
    server: {
      host: "127.0.0.1",
      port: Number(env.WEB_PORT) || 5173,
      proxy: {
        "/api": {
          target: `http://127.0.0.1:${apiPort}`,
          changeOrigin: true,
        },
      },
    },
  };
});
