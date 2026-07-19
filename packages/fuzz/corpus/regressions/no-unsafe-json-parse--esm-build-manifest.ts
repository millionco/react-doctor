// rule: no-unsafe-json-parse
// weakness: framework-gating
// source: local RDE validation (PostHog lemon-ui build script)
import * as fs from "node:fs";

export const { name } = JSON.parse(fs.readFileSync("package.json", "utf8"));
