const path = require("node:path");

module.exports = {
  resolve: {
    alias: {
      Actions: path.resolve(__dirname, "app/views/actions"),
      Utils: path.join(__dirname, "app", "views", "utils"),
    },
    modules: [path.resolve(__dirname, "src"), "node_modules"],
  },
};
