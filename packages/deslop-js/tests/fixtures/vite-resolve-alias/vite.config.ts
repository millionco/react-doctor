import { fileURLToPath, URL } from "node:url";
import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@lib": path.resolve(__dirname, "src/lib"),
    },
  },
});
