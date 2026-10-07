import { defineConfig } from "vite";

// Builds the standalone player embedded into exported HTML games.
export default defineConfig({
  build: {
    lib: { entry: "src/index.ts", name: "Slate", formats: ["iife"], fileName: () => "slate-runtime.iife.js" },
    outDir: "dist",
    emptyOutDir: true,
    minify: true,
  },
});
