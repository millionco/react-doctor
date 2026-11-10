import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noArrayIndexAsKey } from "./no-array-index-as-key.js";

describe("guarded string leaves preserve positional keys", () => {
  it.each([
    [
      "object-pattern index write",
      "token, index",
      '({ value: index } = { value: 0 }); return typeof token === "string" ? <b key={index}>{token}</b> : null;',
      1,
    ],
    [
      "default-pattern index write",
      "token, index",
      '[index = 0] = []; return typeof token === "string" ? <b key={index}>{token}</b> : null;',
      1,
    ],
    [
      "rest-pattern index write",
      "token, index",
      '[...index] = [0]; return typeof token === "string" ? <b key={index}>{token}</b> : null;',
      1,
    ],
    [
      "guarded token pattern write",
      "token, index",
      'return typeof token === "string" && ([token] = [items], <b key={index}>{token}</b>);',
      1,
    ],
    [
      "captured token pattern write",
      "token, index",
      'const replace = () => { [token] = [items]; }; return typeof token === "string" && (replace(), <b key={index}>{token}</b>);',
      1,
    ],
    [
      "overwritten index",
      "token, index",
      'index = 0; return typeof token === "string" ? <b key={index}>{token}</b> : null;',
      1,
    ],
    [
      "captured index write",
      "token, index",
      'const reset = () => { index = 0; }; reset(); return typeof token === "string" ? <b key={index}>{token}</b> : null;',
      1,
    ],
    [
      "incremented index",
      "token, index",
      'index++; return typeof token === "string" ? <b key={index}>{token}</b> : null;',
      1,
    ],
    [
      "destructuring index write",
      "token, index",
      '[index] = [0]; return typeof token === "string" ? <b key={index}>{token}</b> : null;',
      1,
    ],
    [
      "overwritten default index",
      "token, index = 0",
      'index = 0; return typeof token === "string" ? <b key={index}>{token}</b> : null;',
      1,
    ],
    [
      "readonly index",
      "token, index",
      'return typeof token === "string" ? <b key={index}>{token}</b> : null;',
      0,
    ],
    [
      "readonly default index",
      "token, index = 0",
      'return typeof token === "string" ? <b key={index}>{token}</b> : null;',
      0,
    ],
    [
      "shadowed unrelated index write",
      "token, index",
      'const reset = (index) => { index = 0; }; reset(1); return typeof token === "string" ? <b key={index}>{token}</b> : null;',
      0,
    ],
    [
      "stable token key",
      "token, index",
      'index = 0; return typeof token === "string" ? <b key={token}>{token}</b> : null;',
      0,
    ],
    [
      "overwritten key alias",
      "token, index",
      'let key = index; key = 0; return typeof token === "string" ? <b key={key}>{token}</b> : null;',
      1,
    ],
    [
      "captured key alias write",
      "token, index",
      'let key = index; const reset = () => { key = 0; }; reset(); return typeof token === "string" ? <b key={key}>{token}</b> : null;',
      1,
    ],
    [
      "unproven readonly key alias",
      "token, index",
      'const key = index; return typeof token === "string" ? <b key={key}>{token}</b> : null;',
      1,
    ],
    [
      "computed modulo key",
      "token, index",
      'return typeof token === "string" ? <b key={index % 2}>{token}</b> : null;',
      1,
    ],
    [
      "unproven template key",
      "token, index",
      'return typeof token === "string" ? <b key={`part-${index}`}>{token}</b> : null;',
      1,
    ],
  ])("checks %s", (_description, parameters, body, diagnosticCount) => {
    const result = runRule(
      noArrayIndexAsKey,
      `export const View = ({ items }) => items.map((${parameters}) => { ${body} });`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(diagnosticCount);
  });
});
