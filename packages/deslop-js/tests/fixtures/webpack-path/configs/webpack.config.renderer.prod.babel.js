const path = require("path");
module.exports = {
  entry: path.join(__dirname, "..", "app/index"),
  output: { path: path.resolve(__dirname, "dist") },
};
