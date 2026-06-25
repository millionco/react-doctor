import { defineConfig } from "vite";
import { myPlugin } from "./src/vite-plugin";

export default defineConfig({
  plugins: [myPlugin()],
});
