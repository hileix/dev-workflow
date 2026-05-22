import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const localServerPort = process.env.LOCAL_SERVER_PORT || process.env.PORT || "3900";
const localServerUrl = `http://localhost:${localServerPort}`;

export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
  },
  server: {
    proxy: {
      "/api": localServerUrl,
      "/ws": {
        target: localServerUrl,
        ws: true,
      },
    },
  },
});
