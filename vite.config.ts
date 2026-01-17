import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  build: {
    lib: {
      entry: {
        "multi-room": resolve(__dirname, "src/scenarios/multi-room.ts"),
        "specified-one-room": resolve(__dirname, "src/scenarios/specified-one-room.ts"),
        "load-test": resolve(__dirname, "src/scenarios/load-test.ts"),
        "stress-test": resolve(__dirname, "src/scenarios/stress-test.ts"),
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
