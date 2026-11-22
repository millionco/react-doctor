const { copyFileSync } = require("node:fs");
const path = require("node:path");

for (const extension of ["cjs", "mjs"]) {
  copyFileSync(
    path.join(__dirname, "..", "alternate-entries", `strip.${extension}`),
    path.join(__dirname, "..", "build", `strip.${extension}`),
  );
}
