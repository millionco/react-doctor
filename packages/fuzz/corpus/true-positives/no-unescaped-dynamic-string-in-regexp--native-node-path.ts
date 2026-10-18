// rule: no-unescaped-dynamic-string-in-regexp
// verdict: fail
// weakness: native-provider-literal-role
// source: independently synthetic finite Node path provider control

import * as path from "node:path";

const assetDirectory = path.resolve("assets");
export const assetMatcher = new RegExp(`${assetDirectory}/bundle/.*`);
