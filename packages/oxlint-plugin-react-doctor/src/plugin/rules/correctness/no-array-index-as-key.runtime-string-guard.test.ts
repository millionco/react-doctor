import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noArrayIndexAsKey } from "./no-array-index-as-key.js";

describe("runtime string token leaves", () => {
  it("retains a function callback whose arguments can replace its parameter", () => {
    const result = runRule(
      noArrayIndexAsKey,
      `const Highlight = props => props.text.split(props.pattern).map(function(token, index) {
        return typeof token === "string" &&
          (arguments[0] = props.replacement, <span key={index}>{token}</span>);
      });`,
      { filename: "highlight.cjs", forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it.each([
    ['typeof token === "string" && <span key={index}>{token}</span>', 0],
    ['"string" === typeof token && <b key={index}>{token}</b>', 0],
    ['typeof (token) === "string" ? <span key={index}>{token}</span> : null', 0],
    [
      'typeof token === "string" && token.match(props.pattern) ? <b key={index}>{token}</b> : null',
      0,
    ],
    ['typeof token === "string" && <span key={index} className="token">{token}</span>', 0],
    ["<span key={index}>{token}</span>", 1],
    ['typeof props.other === "string" && <span key={index}>{token}</span>', 1],
    ['typeof token === "object" && <span key={index}>{token}</span>', 1],
    ['typeof token === "string" || <span key={index}>{token}</span>', 1],
    ['typeof token === "string" ? null : <span key={index}>{token}</span>', 1],
    ['(typeof token === "string" || props.ready) && <span key={index}>{token}</span>', 1],
    ['typeof token.value === "string" && <span key={index}>{token}</span>', 1],
    ['typeof (token as string) === "string" && <span key={index}>{token}</span>', 1],
    ['typeof token === "string" && (token = props.other, <span key={index}>{token}</span>)', 1],
    [
      '{ const change = () => { token = props.other; }; return typeof token === "string" && (change(), <span key={index}>{token}</span>); }',
      1,
    ],
    [
      'typeof token === "string" && (eval("token = replacement"), <span key={index}>{token}</span>)',
      1,
    ],
    ['() => typeof token === "string" && <span key={index}>{token}</span>', 1],
    ['typeof token === "string" && <span key={index} ref={props.ref}>{token}</span>', 1],
    ['typeof token === "string" && <span key={index} onClick={props.onClick}>{token}</span>', 1],
    ['typeof token === "string" && <span key={index} {...props.attributes}>{token}</span>', 1],
    [
      'typeof token === "string" && <span key={index} className={props.className}>{token}</span>',
      1,
    ],
    ['typeof token === "string" && <span key={index}><input defaultValue={token}/></span>', 1],
    ['typeof token === "string" && <span key={index}><Widget value={token}/></span>', 1],
    ['typeof token === "string" && <span key={index}>{props.render(token)}</span>', 1],
    [
      '<>{typeof token === "string" && <span key={index}>{token}</span>}<span key={index}>{token}</span></>',
      1,
    ],
  ])("checks %s", (body, count) => {
    const result = runRule(
      noArrayIndexAsKey,
      `export const Highlight = props => props.text.split(props.pattern).map((token, index) => ${body});`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(count);
  });
});
