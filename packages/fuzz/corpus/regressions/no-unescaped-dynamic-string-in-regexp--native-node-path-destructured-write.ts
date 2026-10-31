// rule: no-unescaped-dynamic-string-in-regexp
// verdict: pass
// weakness: alias-guard
// source: independently synthetic path binding assignment control
// file-path: src/native-node-path-destructured-write.ts

import * as path from "node:path";
const rootPath = path.resolve("/tmp/assets");
({ rootPath } = { rootPath: "/changed" });
const _matcher = new RegExp(`${rootPath}/bundle/.*`);
