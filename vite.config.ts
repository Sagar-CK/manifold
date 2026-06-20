import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron/simple";
import renderer from "vite-plugin-electron-renderer";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  plugins: [
    electron({
      main: {
        entry: "electron/bootstrap.ts",
        vite: {
          build: {
            // Preload shares dist-electron/; clearing would delete preload.mjs on main rebuild.
            emptyOutDir: false,
            rollupOptions: {
              external: [
                "electron",
                "sharp",
                "@napi-rs/canvas",
                /^node:/,
                /^@img\//,
              ],
            },
          },
        },
      },
      preload: {
        input: path.join(__dirname, "electron/preload.ts"),
        vite: {
          build: {
            rollupOptions: {
              output: {
                entryFileNames: "preload.mjs",
              },
            },
          },
        },
      },
      renderer: {},
    }),
    renderer(),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
});
