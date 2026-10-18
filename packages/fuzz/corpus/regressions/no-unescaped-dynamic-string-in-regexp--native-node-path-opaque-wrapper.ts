// rule: no-unescaped-dynamic-string-in-regexp
// verdict: pass
// weakness: native-provider-opaque-wrapper
// source: independently synthetic unsupported wrapper control

import * as path from "node:path";

const prepare = (value: string): string => value;
const assetDirectory = prepare(path.resolve("assets"));
export const assetMatcher = new RegExp(`${assetDirectory}/bundle/.*`);
