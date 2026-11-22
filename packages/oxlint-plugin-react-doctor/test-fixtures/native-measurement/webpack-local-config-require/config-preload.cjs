const path = require("path");
const resolve = path.resolve;
path.resolve = (...parts) =>
  parts.at(-1) === "src" ? resolve(...parts.slice(0, -1), "alternate") : resolve(...parts);
module.exports = {};
