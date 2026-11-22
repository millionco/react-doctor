const path = require("path");
const common = { mode: "production" };
const modern = Object.assign({}, common, {
  entry: ["./src/Strip.tsx"],
  output: { path: path.resolve(__dirname, "build"), filename: "strip.mjs" },
  resolve: {
    alias: { src: path.resolve(__dirname, "src") },
    extensions: [".ts", ".tsx", ".js", ".jsx"],
  },
  externals: {
    react: "react",
    "react-dom": "react-dom",
    "src/Rail": "commonjs ../src/AlternateRail.cjs",
  },
});
const legacy = Object.assign({}, common, {
  entry: ["./src/Strip.tsx"],
  output: { path: path.resolve(__dirname, "build"), filename: "strip.cjs" },
  resolve: {
    alias: { src: path.resolve(__dirname, "src") },
    extensions: [".ts", ".tsx", ".js", ".jsx"],
  },
  externals: {
    react: "react",
    "react-dom": "react-dom",
    "src/Rail": "commonjs ../src/AlternateRail.cjs",
  },
});
module.exports = [modern, legacy];
