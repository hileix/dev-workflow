import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const relayServerPort = process.env.RELAY_SERVER_PORT || process.env.BACKEND_PORT || "8787";
const relayServerUrl = `http://localhost:${relayServerPort}`;

export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
  },
  server: {
    proxy: {
      "/api": relayServerUrl,
      "/ws": {
        target: relayServerUrl,
        ws: true,
      },
    },
  },
});
