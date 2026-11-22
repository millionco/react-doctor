const { copyFileSync } = require("node:fs");
const path = require("node:path");

copyFileSync(
  path.join(__dirname, "..", "alternate-entries", "Rail.tsx"),
  path.join(__dirname, "..", "src", "Rail.tsx"),
);
