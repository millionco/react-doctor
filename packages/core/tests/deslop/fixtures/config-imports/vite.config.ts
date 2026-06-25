import { myVitePlugin } from "./my-vite-plugin";
import { sharedUtil } from "./src/shared-util";

export default {
  plugins: [myVitePlugin()],
  define: {
    __UTIL__: sharedUtil(),
  },
};
