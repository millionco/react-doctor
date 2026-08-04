import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const runtimeRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: runtimeRoot,
});
