import { defineConfig } from "vite";

function replaceOnce(html: string, source: string, target: string): string {
  if (html.split(source).length !== 2) throw new Error(`Toy HTML anchor must occur once: ${source}`);
  return html.replace(source, target);
}

function toyEntry(html: string): string {
  html = html.replace(/<link\b[^>]*https:\/\/fonts\.(?:googleapis|gstatic)\.com[^>]*>/g, "");
  html = replaceOnce(html, 'id="btn-online" class="ghost"', 'id="btn-online" class="ghost" disabled');
  html = replaceOnce(html, 'data-i18n="联机对战">联机对战', 'data-i18n="此版本不提供联机">此版本不提供联机');
  return replaceOnce(html, '<p id="title-best"', '<p class="fineprint" data-i18n="Toy 单机版 · 无需登录，纪录与设置保存在本机">Toy 单机版 · 无需登录，纪录与设置保存在本机</p><p id="title-best"');
}

export default defineConfig(({ mode }) => ({
  base: mode === "toy" ? "./" : "/",
  build: { outDir: mode === "toy" ? "../artifacts/toy/dist" : "dist", emptyOutDir: true },
  plugins: mode === "toy" ? [{
    name: "toy-offline-entry",
    transformIndexHtml: {
      order: "pre",
      handler: toyEntry,
    },
  }] : [],
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
}));
