import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  build: {
    lib: {
      entry: {
        "multi-room": resolve(__dirname, "src/scenarios/multi-room.ts"),
        "single-room": resolve(__dirname, "src/scenarios/single-room.ts"),
      },
      formats: ["es"],
      fileName: (_, entryName) => `${entryName}.js`,
    },
    outDir: "dist",
    minify: false,
    sourcemap: true,
    rollupOptions: {
      external: [/^k6(\/.*)?$/, /^https?:\/\/.*/],
      output: {
        preserveModules: false,
        entryFileNames: "[name].js",
      },
    },
  },
  resolve: {
    alias: {
      "@lib": resolve(__dirname, "src/lib"),
      "@scenarios": resolve(__dirname, "src/scenarios"),
    },
  },
});
