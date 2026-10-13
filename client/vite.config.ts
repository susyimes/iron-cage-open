import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: "0.0.0.0",
    port: 43153,
    strictPort: true,
    proxy: {
      "/ws": { target: "ws://127.0.0.1:43154", ws: true },
    },
  },
  preview: {
    host: "0.0.0.0",
    port: 43153,
  },
});
