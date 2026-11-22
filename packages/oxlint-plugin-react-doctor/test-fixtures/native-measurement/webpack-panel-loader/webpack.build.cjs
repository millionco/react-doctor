const path = require("path");
const common = { mode: "production" };
const modern = Object.assign({}, common, {
  entry: ["./src/Strip.tsx"],
  output: { path: path.resolve(__dirname, "build"), filename: "strip.mjs" },
  resolve: {
    alias: { src: path.resolve(__dirname, "src") },
    extensions: [".ts", ".tsx", ".js", ".jsx"],
  },
  module: { rules: [{ test: /Rail\.tsx$/, loader: path.resolve(__dirname, "panel-loader.cjs") }] },
  externals: { react: "react", "react-dom": "react-dom" },
});
const legacy = Object.assign({}, common, {
  entry: ["./src/Strip.tsx"],
  output: { path: path.resolve(__dirname, "build"), filename: "strip.cjs" },
  resolve: {
    alias: { src: path.resolve(__dirname, "src") },
    extensions: [".ts", ".tsx", ".js", ".jsx"],
  },
  module: { rules: [{ test: /Rail\.tsx$/, loader: path.resolve(__dirname, "panel-loader.cjs") }] },
  externals: { react: "react", "react-dom": "react-dom" },
});
module.exports = [modern, legacy];
