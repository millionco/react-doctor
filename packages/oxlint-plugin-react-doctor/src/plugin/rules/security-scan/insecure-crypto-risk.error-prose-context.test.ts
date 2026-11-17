import { describe, expect, it } from "vite-plus/test";
import { runScanRule } from "../../../test-utils/run-scan-rule.js";
import { insecureCryptoRisk } from "./insecure-crypto-risk.js";

describe("insecure-crypto-risk disjoint Error prose context", () => {
  it("different-method-local-literal-error-prose", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/random-context.js",
        content:
          'class Data { constructor(){this.key=Math.random()} fail(){throw new Error("Invalid token in expression")} }',
      }),
    ).toEqual([]);
  });

  it("different-method-locally-declared-string-payload", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/random-context.js",
        content:
          'class Data { constructor(){this.key=Math.random()} fail(){const value="invalid";throw new Error("Unexpected token: "+value)} }',
      }),
    ).toEqual([]);
  });

  it("original-shaped-local-index-payload", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/random-context.js",
        content:
          'class Data { constructor(){this.key=Math.random()} fail(entries){for(let index=0;index<entries.length;index++){const item=entries[index];let value=item[0];if(value!=="and")throw new Error("Unexpected token: "+value)}} }',
      }),
    ).toEqual([]);
  });

  it("same-function-error-prose", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/random-context.js",
        content: 'function create(){const value=Math.random();throw new Error("Unexpected token")}',
      }),
    ).toEqual([
      {
        message:
          "Code uses weak hashes, deprecated ciphers, timing-unsafe comparisons, or Math.random in a security-shaped context.",
        line: 1,
        column: 31,
      },
    ]);
  });

  it("security-identifier", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/random-context.js",
        content:
          'function make(){const token=Math.random();return token} function fail(){throw new Error("Invalid token")}',
      }),
    ).toEqual([
      {
        message:
          "Code uses weak hashes, deprecated ciphers, timing-unsafe comparisons, or Math.random in a security-shaped context.",
        line: 1,
        column: 29,
      },
    ]);
  });

  it("security-member", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/random-context.js",
        content:
          'function make(){return Math.random()} function save(target){target.token="existing"} function fail(){throw new Error("Invalid token")}',
      }),
    ).toEqual([
      {
        message:
          "Code uses weak hashes, deprecated ciphers, timing-unsafe comparisons, or Math.random in a security-shaped context.",
        line: 1,
        column: 24,
      },
    ]);
  });

  it("security-static-key", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/random-context.js",
        content:
          'function make(){return Math.random()} const options={"token":"existing"}; function fail(){throw new Error("Invalid token")}',
      }),
    ).toEqual([
      {
        message:
          "Code uses weak hashes, deprecated ciphers, timing-unsafe comparisons, or Math.random in a security-shaped context.",
        line: 1,
        column: 24,
      },
    ]);
  });

  it("security-computed-key", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/random-context.js",
        content:
          'function make(){return Math.random()} const options={["token"]:"existing"}; function fail(){throw new Error("Invalid token")}',
      }),
    ).toEqual([
      {
        message:
          "Code uses weak hashes, deprecated ciphers, timing-unsafe comparisons, or Math.random in a security-shaped context.",
        line: 1,
        column: 24,
      },
    ]);
  });

  it("literal-prefix-direct-consumer", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/random-context.js",
        content:
          'function make(){return "token-"+Math.random()} function fail(){throw new Error("Invalid token")}',
      }),
    ).toEqual([
      {
        message:
          "Code uses weak hashes, deprecated ciphers, timing-unsafe comparisons, or Math.random in a security-shaped context.",
        line: 1,
        column: 33,
      },
    ]);
  });

  it("literal-prefix-cross-function-consumer", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/random-context.js",
        content: 'function next(){return Math.random()} function issue(){return "token-"+next()}',
      }),
    ).toEqual([
      {
        message:
          "Code uses weak hashes, deprecated ciphers, timing-unsafe comparisons, or Math.random in a security-shaped context.",
        line: 1,
        column: 24,
      },
    ]);
  });

  it("token-assignment-after-call", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/random-context.js",
        content:
          'function issue(){let value=Math.random();let token=value;return token} function fail(){throw new Error("Invalid token")}',
      }),
    ).toEqual([
      {
        message:
          "Code uses weak hashes, deprecated ciphers, timing-unsafe comparisons, or Math.random in a security-shaped context.",
        line: 1,
        column: 28,
      },
    ]);
  });

  it("unknown-literal-consumer", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/random-context.js",
        content: 'function next(){return Math.random()} function publish(send){send("token")}',
      }),
    ).toEqual([
      {
        message:
          "Code uses weak hashes, deprecated ciphers, timing-unsafe comparisons, or Math.random in a security-shaped context.",
        line: 1,
        column: 24,
      },
    ]);
  });

  it("captured-error-payload", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/random-context.js",
        content:
          'const captured="invalid";class Data {constructor(){this.key=Math.random()}fail(){throw new Error("Unexpected token: "+captured)}}',
      }),
    ).toEqual([
      {
        message:
          "Code uses weak hashes, deprecated ciphers, timing-unsafe comparisons, or Math.random in a security-shaped context.",
        line: 1,
        column: 61,
      },
    ]);
  });

  it("call-error-payload", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/random-context.js",
        content:
          'class Data {constructor(){this.key=Math.random()}fail(read){throw new Error("Unexpected token: "+read())}}',
      }),
    ).toEqual([
      {
        message:
          "Code uses weak hashes, deprecated ciphers, timing-unsafe comparisons, or Math.random in a security-shaped context.",
        line: 1,
        column: 36,
      },
    ]);
  });

  it("getter-error-payload", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/random-context.js",
        content:
          'class Data {constructor(){this.key=Math.random()}fail(input){throw new Error("Unexpected token: "+input.value)}}',
      }),
    ).toEqual([
      {
        message:
          "Code uses weak hashes, deprecated ciphers, timing-unsafe comparisons, or Math.random in a security-shaped context.",
        line: 1,
        column: 36,
      },
    ]);
  });

  it("local-object-coercion", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/random-context.js",
        content:
          'class Data {constructor(){this.key=Math.random()}fail(){const value={toString(){return "invalid"}};throw new Error("Unexpected token: "+value)}}',
      }),
    ).toEqual([
      {
        message:
          "Code uses weak hashes, deprecated ciphers, timing-unsafe comparisons, or Math.random in a security-shaped context.",
        line: 1,
        column: 36,
      },
    ]);
  });

  it("custom-error-binding", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/random-context.js",
        content:
          'function Error(message){this.message=message} class Data {constructor(){this.key=Math.random()}fail(){throw new Error("Unexpected token")}}',
      }),
    ).toEqual([
      {
        message:
          "Code uses weak hashes, deprecated ciphers, timing-unsafe comparisons, or Math.random in a security-shaped context.",
        line: 1,
        column: 82,
      },
    ]);
  });

  it("error-parameter-shadow", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/random-context.js",
        content:
          'function install(Error){class Data {constructor(){this.key=Math.random()}fail(){throw new Error("Unexpected token")}}return Data}',
      }),
    ).toEqual([
      {
        message:
          "Code uses weak hashes, deprecated ciphers, timing-unsafe comparisons, or Math.random in a security-shaped context.",
        line: 1,
        column: 60,
      },
    ]);
  });

  it("erased-error-shadow", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/random-context.ts",
        content:
          'declare const Error: new(message:string)=>unknown;class Data {constructor(){this.key=Math.random()}fail(){throw new Error("Unexpected token")}}',
      }),
    ).toEqual([
      {
        message:
          "Code uses weak hashes, deprecated ciphers, timing-unsafe comparisons, or Math.random in a security-shaped context.",
        line: 1,
        column: 86,
      },
    ]);
  });

  it("visible-error-global-replacement", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/random-context.js",
        content:
          'globalThis.Error=class {constructor(message){this.message=message}};class Data {constructor(){this.key=Math.random()}fail(){throw new Error("Unexpected token")}}',
      }),
    ).toEqual([
      {
        message:
          "Code uses weak hashes, deprecated ciphers, timing-unsafe comparisons, or Math.random in a security-shaped context.",
        line: 1,
        column: 104,
      },
    ]);
  });

  it("eval-provider-replacement", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/random-context.js",
        content:
          'eval("globalThis.Error = class { constructor(message){this.message=message} }");class Data {constructor(){this.key=Math.random()}fail(){throw new Error("Unexpected token")}}',
      }),
    ).toEqual([
      {
        message:
          "Code uses weak hashes, deprecated ciphers, timing-unsafe comparisons, or Math.random in a security-shaped context.",
        line: 1,
        column: 116,
      },
    ]);
  });

  it("unrelated-other-module-eval", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/random-context.js",
        content:
          '(()=>{class Data {constructor(){this.key=Math.random()}fail(){throw new Error("Unexpected token")}}})();(()=>{const value="1";eval(value)})();',
      }),
    ).toEqual([]);
  });

  it("caught-error-message-consumer", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/random-context.js",
        content:
          'function make(){return Math.random()} function fail(){throw new Error("Invalid token")} function issue(){try{fail()}catch(error){return error.message+make()}}',
      }),
    ).toEqual([
      {
        message:
          "Code uses weak hashes, deprecated ciphers, timing-unsafe comparisons, or Math.random in a security-shaped context.",
        line: 1,
        column: 24,
      },
    ]);
  });

  it("first-exempt-then-reportable-random", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/random-context.js",
        content:
          'class Data {constructor(){this.key=Math.random()}fail(){throw new Error("Invalid token")}}\nfunction issue(){return "token-"+Math.random()}',
      }),
    ).toEqual([
      {
        message:
          "Code uses weak hashes, deprecated ciphers, timing-unsafe comparisons, or Math.random in a security-shaped context.",
        line: 2,
        column: 34,
      },
    ]);
  });

  it("earlier-weak-hash-pass", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/random-context.js",
        content:
          'import {createHash} from "node:crypto";const secretDigest=createHash("md5").update("x").digest("hex");class Data{constructor(){this.key=Math.random()}fail(){throw new Error("Invalid token")}}',
      }),
    ).toEqual([
      {
        message:
          "Code uses weak hashes, deprecated ciphers, timing-unsafe comparisons, or Math.random in a security-shaped context.",
        line: 1,
        column: 59,
      },
    ]);
  });

  it("earlier-deprecated-cipher-pass", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/random-context.js",
        content:
          'import {createCipher} from "node:crypto";const cipher=createCipher("aes192","password");class Data{constructor(){this.key=Math.random()}fail(){throw new Error("Invalid token")}}',
      }),
    ).toEqual([
      {
        message:
          "Code uses weak hashes, deprecated ciphers, timing-unsafe comparisons, or Math.random in a security-shaped context.",
        line: 1,
        column: 55,
      },
    ]);
  });

  it("comment-only-security-word", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/random-context.js",
        content: "function make(){return Math.random()} // token\n",
      }),
    ).toEqual([]);
  });

  it("regex-security-word", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/random-context.js",
        content: "function make(){return Math.random()} const pattern=/token/;",
      }),
    ).toEqual([
      {
        message:
          "Code uses weak hashes, deprecated ciphers, timing-unsafe comparisons, or Math.random in a security-shaped context.",
        line: 1,
        column: 24,
      },
    ]);
  });

  it("template-error-prose", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/random-context.js",
        content:
          "class Data {constructor(){this.key=Math.random()}fail(){throw new Error(`Invalid token`)}}",
      }),
    ).toEqual([
      {
        message:
          "Code uses weak hashes, deprecated ciphers, timing-unsafe comparisons, or Math.random in a security-shaped context.",
        line: 1,
        column: 36,
      },
    ]);
  });

  it("multiple-security-evidence", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/random-context.js",
        content:
          'class Data {constructor(){this.key=Math.random()}fail(){throw new Error("Invalid token")}} const secret="existing";',
      }),
    ).toEqual([
      {
        message:
          "Code uses weak hashes, deprecated ciphers, timing-unsafe comparisons, or Math.random in a security-shaped context.",
        line: 1,
        column: 36,
      },
    ]);
  });

  it("same-outer-function-different-nested-function", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/random-context.js",
        content:
          'function setup(){const value=Math.random();function fail(){throw new Error("Invalid token")}return {value,fail}}',
      }),
    ).toEqual([
      {
        message:
          "Code uses weak hashes, deprecated ciphers, timing-unsafe comparisons, or Math.random in a security-shaped context.",
        line: 1,
        column: 30,
      },
    ]);
  });

  it("unicode-before-call", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/random-context.js",
        content:
          'const heading="\ud83d\udd12";class Data {constructor(){this.key=Math.random()}fail(){throw new Error("Invalid token")}}',
      }),
    ).toEqual([
      {
        message:
          "Code uses weak hashes, deprecated ciphers, timing-unsafe comparisons, or Math.random in a security-shaped context.",
        line: 1,
        column: 55,
      },
    ]);
  });

  it("crlf-context-boundary", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/random-context.js",
        content:
          'class Data {constructor(){this.key=Math.random()}}\r\nfunction fail(){throw new Error("Invalid token")}',
      }),
    ).toEqual([]);
  });

  it("malformed-source-fallback", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/random-context.js",
        content:
          'class Data {constructor(){this.key=Math.random()}fail(){throw new Error("Invalid token")}',
      }),
    ).toEqual([
      {
        message:
          "Code uses weak hashes, deprecated ciphers, timing-unsafe comparisons, or Math.random in a security-shaped context.",
        line: 1,
        column: 36,
      },
    ]);
  });

  it("returned-named-token-function", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/random-context.js",
        content:
          'function generateToken(){return Math.random()} function fail(){throw new Error("Invalid token")}',
      }),
    ).toEqual([
      {
        message:
          "Code uses weak hashes, deprecated ciphers, timing-unsafe comparisons, or Math.random in a security-shaped context.",
        line: 1,
        column: 33,
      },
    ]);
  });

  it("assigned-token-function", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/random-context.js",
        content:
          'const tokenFactory=()=>Math.random(); function fail(){throw new Error("Invalid token")}',
      }),
    ).toEqual([
      {
        message:
          "Code uses weak hashes, deprecated ciphers, timing-unsafe comparisons, or Math.random in a security-shaped context.",
        line: 1,
        column: 24,
      },
    ]);
  });

  it("assigned-member-token-function", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/random-context.js",
        content:
          'exports.sessionToken=()=>Math.random(); function fail(){throw new Error("Invalid token")}',
      }),
    ).toEqual([
      {
        message:
          "Code uses weak hashes, deprecated ciphers, timing-unsafe comparisons, or Math.random in a security-shaped context.",
        line: 1,
        column: 26,
      },
    ]);
  });

  it("object-property-token-function", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/random-context.js",
        content:
          'const api={token(){return Math.random()},fail(){throw new Error("Invalid token")}};',
      }),
    ).toEqual([
      {
        message:
          "Code uses weak hashes, deprecated ciphers, timing-unsafe comparisons, or Math.random in a security-shaped context.",
        line: 1,
        column: 27,
      },
    ]);
  });

  it("direct-object-token-value", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/random-context.js",
        content:
          'const output={token:Math.random()};function fail(){throw new Error("Invalid token")}',
      }),
    ).toEqual([
      {
        message:
          "Code uses weak hashes, deprecated ciphers, timing-unsafe comparisons, or Math.random in a security-shaped context.",
        line: 1,
        column: 21,
      },
    ]);
  });

  it("captured-output-binding", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/random-context.js",
        content:
          'let value;function next(){value=Math.random()}function fail(){throw new Error("Invalid token: "+value)}',
      }),
    ).toEqual([
      {
        message:
          "Code uses weak hashes, deprecated ciphers, timing-unsafe comparisons, or Math.random in a security-shaped context.",
        line: 1,
        column: 33,
      },
    ]);
  });

  it("captured-output-member", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/random-context.js",
        content:
          'class Data{constructor(){this.key=Math.random()}fail(){throw new Error("Invalid token: "+this.key)}}',
      }),
    ).toEqual([
      {
        message:
          "Code uses weak hashes, deprecated ciphers, timing-unsafe comparisons, or Math.random in a security-shaped context.",
        line: 1,
        column: 35,
      },
    ]);
  });

  it("direct-producer-function-call", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/random-context.js",
        content:
          'function next(){return Math.random()}function fail(){throw new Error("Invalid token: "+next())}',
      }),
    ).toEqual([
      {
        message:
          "Code uses weak hashes, deprecated ciphers, timing-unsafe comparisons, or Math.random in a security-shaped context.",
        line: 1,
        column: 24,
      },
    ]);
  });

  it("opaque-token-consumer", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/random-context.js",
        content: 'function next(){return Math.random()}function send(publish){publish("token")}',
      }),
    ).toEqual([
      {
        message:
          "Code uses weak hashes, deprecated ciphers, timing-unsafe comparisons, or Math.random in a security-shaped context.",
        line: 1,
        column: 24,
      },
    ]);
  });

  it("same-owner-real-token-literal", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/random-context.js",
        content:
          'function issue(){return "token-"+Math.random()}function fail(){throw new Error("Invalid token")}',
      }),
    ).toEqual([
      {
        message:
          "Code uses weak hashes, deprecated ciphers, timing-unsafe comparisons, or Math.random in a security-shaped context.",
        line: 1,
        column: 34,
      },
    ]);
  });

  it("constructor receiver alias with captured key must retain old context", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/data-adapter.js",
        content:
          'class Example { constructor() { const receiver = Object.assign(this, {}); receiver.key = Math.random(); } fail() { throw new Error("invalid token: " + this.key); } }\n',
      }),
    ).toEqual([
      {
        message:
          "Code uses weak hashes, deprecated ciphers, timing-unsafe comparisons, or Math.random in a security-shaped context.",
        line: 1,
        column: 90,
      },
    ]);
  });

  it("constructor receiver alias with unrelated parser token prose", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/data-adapter.js",
        content:
          'class Example { constructor() { const receiver = Object.assign(this, {}); receiver.key = Math.random(); } parse(value) { if (value !== "AND") throw new Error("unexpected token: " + value); return value; } }\n',
      }),
    ).toEqual([]);
  });

  it("selected output alias is visible outside Error payload", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/random-context.js",
        content:
          'let value;function make(){value=Math.random()}make();const alias=value;function fail(){consume(alias);throw new Error("token")}',
      }),
    ).toEqual([
      {
        message:
          "Code uses weak hashes, deprecated ciphers, timing-unsafe comparisons, or Math.random in a security-shaped context.",
        line: 1,
        column: 33,
      },
    ]);
  });

  it("selected producer alias is visible outside Error payload", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/random-context.js",
        content:
          'function next(){return Math.random()}const get=next;function fail(){consume(get());throw new Error("token")}',
      }),
    ).toEqual([
      {
        message:
          "Code uses weak hashes, deprecated ciphers, timing-unsafe comparisons, or Math.random in a security-shaped context.",
        line: 1,
        column: 24,
      },
    ]);
  });

  it("later local payload call preserves old context", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/random-context.js",
        content:
          'class Data{constructor(){this.key=Math.random()}fail(read){let value="x";value=read();throw new Error("token: "+value)}}',
      }),
    ).toEqual([
      {
        message:
          "Code uses weak hashes, deprecated ciphers, timing-unsafe comparisons, or Math.random in a security-shaped context.",
        line: 1,
        column: 35,
      },
    ]);
  });

  it("Object.defineProperty replaces global Error", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/random-context.js",
        content:
          'Object.defineProperty(globalThis,"Error",{value:class {}});class Data{constructor(){this.key=Math.random()}fail(){throw new Error("token")}}',
      }),
    ).toEqual([
      {
        message:
          "Code uses weak hashes, deprecated ciphers, timing-unsafe comparisons, or Math.random in a security-shaped context.",
        line: 1,
        column: 94,
      },
    ]);
  });

  it("Object.assign replaces global Error", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/random-context.js",
        content:
          'Object.assign(globalThis,{Error:class {}});class Data{constructor(){this.key=Math.random()}fail(){throw new Error("token")}}',
      }),
    ).toEqual([
      {
        message:
          "Code uses weak hashes, deprecated ciphers, timing-unsafe comparisons, or Math.random in a security-shaped context.",
        line: 1,
        column: 78,
      },
    ]);
  });

  it("Reflect.set replaces global Error", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/random-context.js",
        content:
          'Reflect.set(globalThis,"Error",class {});class Data{constructor(){this.key=Math.random()}fail(){throw new Error("token")}}',
      }),
    ).toEqual([
      {
        message:
          "Code uses weak hashes, deprecated ciphers, timing-unsafe comparisons, or Math.random in a security-shaped context.",
        line: 1,
        column: 76,
      },
    ]);
  });

  it("new Function remains unsupported in the relevant owner", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/random-context.js",
        content:
          'new Function("globalThis.Error = class {}")();class Data{constructor(){this.key=Math.random()}fail(){throw new Error("token")}}',
      }),
    ).toEqual([
      {
        message:
          "Code uses weak hashes, deprecated ciphers, timing-unsafe comparisons, or Math.random in a security-shaped context.",
        line: 1,
        column: 81,
      },
    ]);
  });

  it("global eval remains unsupported in the relevant owner", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/random-context.js",
        content:
          'globalThis.eval("globalThis.Error = class {}");class Data{constructor(){this.key=Math.random()}fail(){throw new Error("token")}}',
      }),
    ).toEqual([
      {
        message:
          "Code uses weak hashes, deprecated ciphers, timing-unsafe comparisons, or Math.random in a security-shaped context.",
        line: 1,
        column: 82,
      },
    ]);
  });

  it("local-this-alias-unknown-computed-selected-random-output-capture", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/random-context.js",
        content:
          'class Data {constructor(){this.key=Math.random()}fail(){const data=this;const field="key";const value=data[field];throw new Error("Unexpected token: "+value)}}',
      }),
    ).toEqual([
      {
        message:
          "Code uses weak hashes, deprecated ciphers, timing-unsafe comparisons, or Math.random in a security-shaped context.",
        line: 1,
        column: 36,
      },
    ]);
  });

  it("visible-let-global-alias-error-provider-replacement", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/random-context.js",
        content:
          'let host=globalThis;host.Error=class{};class Data{constructor(){this.key=Math.random()}fail(){throw new Error("token")}}',
      }),
    ).toEqual([
      {
        message:
          "Code uses weak hashes, deprecated ciphers, timing-unsafe comparisons, or Math.random in a security-shaped context.",
        line: 1,
        column: 74,
      },
    ]);
  });

  it("enclosing-security-class-binding-outside-random-physical-line", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/random-context.js",
        content:
          'class TokenGenerator {\nconstructor(){this.value=Math.random()} fail(){throw new Error("Invalid token")}\n}',
      }),
    ).toEqual([
      {
        message:
          "Code uses weak hashes, deprecated ciphers, timing-unsafe comparisons, or Math.random in a security-shaped context.",
        line: 2,
        column: 26,
      },
    ]);
  });

  it("computed selected output through Object.assign receiver alias", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/random-context.js",
        content:
          'class Data{constructor(){this.key=Math.random()}fail(){const data=Object.assign(this,{});const field="key";const value=data[field];throw new Error("token: "+value)}}',
      }),
    ).toEqual([
      {
        message:
          "Code uses weak hashes, deprecated ciphers, timing-unsafe comparisons, or Math.random in a security-shaped context.",
        line: 1,
        column: 35,
      },
    ]);
  });

  it("caught message and selected producer aliases retain old context", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/random-context.js",
        content:
          'function make(){return Math.random()}const get=make;function fail(){throw new Error("token")}function issue(){try{fail()}catch(error){const caught=error;return caught.message+get()}}',
      }),
    ).toEqual([
      {
        message:
          "Code uses weak hashes, deprecated ciphers, timing-unsafe comparisons, or Math.random in a security-shaped context.",
        line: 1,
        column: 24,
      },
    ]);
  });

  it("ObjectPattern runtime Error write retains old context", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/random-context.js",
        content:
          '({Error}=replacement);class Data{constructor(){this.key=Math.random()}fail(){throw new Error("token")}}',
      }),
    ).toEqual([
      {
        message:
          "Code uses weak hashes, deprecated ciphers, timing-unsafe comparisons, or Math.random in a security-shaped context.",
        line: 1,
        column: 57,
      },
    ]);
  });

  it("ArrayPattern runtime Error write retains old context", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/random-context.js",
        content:
          '[Error]=replacement;class Data{constructor(){this.key=Math.random()}fail(){throw new Error("token")}}',
      }),
    ).toEqual([
      {
        message:
          "Code uses weak hashes, deprecated ciphers, timing-unsafe comparisons, or Math.random in a security-shaped context.",
        line: 1,
        column: 55,
      },
    ]);
  });

  it("nested assignment-pattern Error member write retains old context", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/random-context.js",
        content:
          '({value:host.Error}=replacement);class Data{constructor(){this.key=Math.random()}fail(){throw new Error("token")}}',
      }),
    ).toEqual([
      {
        message:
          "Code uses weak hashes, deprecated ciphers, timing-unsafe comparisons, or Math.random in a security-shaped context.",
        line: 1,
        column: 68,
      },
    ]);
  });

  it("known Error property mutation through unproven host retains old context", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/random-context.js",
        content:
          'let host=globalThis;Object.defineProperty(host,"Error",{value:class{}});class Data{constructor(){this.key=Math.random()}fail(){throw new Error("token")}}',
      }),
    ).toEqual([
      {
        message:
          "Code uses weak hashes, deprecated ciphers, timing-unsafe comparisons, or Math.random in a security-shaped context.",
        line: 1,
        column: 107,
      },
    ]);
  });

  it("unresolved global member output retains old context", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/random-context.js",
        content:
          'function make(){globalThis.value=Math.random()}function fail(){throw new Error("token")}function issue(){try{fail()}catch(error){return error.message+globalThis.value}}',
      }),
    ).toEqual([
      {
        message:
          "Code uses weak hashes, deprecated ciphers, timing-unsafe comparisons, or Math.random in a security-shaped context.",
        line: 1,
        column: 34,
      },
    ]);
  });

  it("computed-catch-parameter-global-error-replacement-missing-scope-reference", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/random-context.js",
        content:
          'try{throw {}}catch({[Error=class{}]:ignored}){};class Data{constructor(){this.key=Math.random()}fail(){throw new Error("token")}}',
      }),
    ).toEqual([
      {
        message:
          "Code uses weak hashes, deprecated ciphers, timing-unsafe comparisons, or Math.random in a security-shaped context.",
        line: 1,
        column: 83,
      },
    ]);
  });

  it("computed-catch-key-destructured-global-error-replacement", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/random-context.js",
        content:
          'try{throw {}}catch({[([Error]=[class{}])]:ignored}){};class Data{constructor(){this.key=Math.random()}fail(){throw new Error("token")}}',
      }),
    ).toEqual([
      {
        message:
          "Code uses weak hashes, deprecated ciphers, timing-unsafe comparisons, or Math.random in a security-shaped context.",
        line: 1,
        column: 89,
      },
    ]);
  });

  it("caught-error-message-through-assignment-alias-combined-with-selected-producer", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/random-context.js",
        content:
          'function make(){return Math.random()}function fail(){throw new Error("token")}function issue(){try{fail()}catch(error){let caught;caught=error;return caught.message+make()}}',
      }),
    ).toEqual([
      {
        message:
          "Code uses weak hashes, deprecated ciphers, timing-unsafe comparisons, or Math.random in a security-shaped context.",
        line: 1,
        column: 24,
      },
    ]);
  });

  it("computed-catch-known-function-provider-replacement", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/random-context.js",
        content:
          'try{throw {}}catch({[Function("globalThis.Error=class{}")()]:ignored}){};class Data{constructor(){this.key=Math.random()}fail(){throw new Error("token")}}',
      }),
    ).toEqual([
      {
        message:
          "Code uses weak hashes, deprecated ciphers, timing-unsafe comparisons, or Math.random in a security-shaped context.",
        line: 1,
        column: 108,
      },
    ]);
  });

  it("computed-catch-known-object-error-provider-replacement", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/random-context.js",
        content:
          'try{throw {}}catch({[Object.defineProperty(globalThis,"Error",{value:class{}})]:ignored}){};class Data{constructor(){this.key=Math.random()}fail(){throw new Error("token")}}',
      }),
    ).toEqual([
      {
        message:
          "Code uses weak hashes, deprecated ciphers, timing-unsafe comparisons, or Math.random in a security-shaped context.",
        line: 1,
        column: 127,
      },
    ]);
  });

  it("selected output read in omitted catch computed expression retains old context", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/random-context.js",
        content:
          "let value;function make(){value=Math.random()}function fail(){try{throw{}}catch({[consume(value)]:ignored}){};throw new Error('token')}",
      }),
    ).toEqual([
      {
        message:
          "Code uses weak hashes, deprecated ciphers, timing-unsafe comparisons, or Math.random in a security-shaped context.",
        line: 1,
        column: 33,
      },
    ]);
  });

  it("selected producer in omitted catch parameter retains old context", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/random-context.js",
        content:
          'function make(){return Math.random()}function fail(){throw new Error("token")}function issue(){try{fail()}catch({message:caughtMessage=make()}){return caughtMessage}}',
      }),
    ).toEqual([
      {
        message:
          "Code uses weak hashes, deprecated ciphers, timing-unsafe comparisons, or Math.random in a security-shaped context.",
        line: 1,
        column: 24,
      },
    ]);
  });
});

describe("erased Error provider bindings", () => {
  it("nominal", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/error-context.tsx",
        content:
          'class Data { constructor(){this.key=Math.random()} fail(){throw new Error("Invalid token in expression")} }',
      }),
    ).toHaveLength(0);
  });
  it("erased-Error", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/error-context.tsx",
        content:
          'interface Error { note:string }; class Data { constructor(){this.key=Math.random()} fail(){throw new Error("Invalid token in expression")} }',
      }),
    ).toHaveLength(0);
  });
  it("erased-Math", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/error-context.tsx",
        content:
          'interface Math { note:string }; class Data { constructor(){this.key=Math.random()} fail(){throw new Error("Invalid token in expression")} }',
      }),
    ).toHaveLength(0);
  });
  it("nested-type", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/error-context.tsx",
        content:
          'type Notes = ({nested:{constructor}}:{nested:{constructor:string}})=>void; class Data { constructor(){this.key=Math.random()} fail(){throw new Error("Invalid token in expression")} }',
      }),
    ).toHaveLength(0);
  });
  it("erased-Function-runtime-mutation", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/error-context.tsx",
        content:
          'interface Function {note:string}; Function("globalThis.Error = function(message){ globalThis.authToken=message; }")(); class Data { constructor(){this.key=Math.random()} fail(){throw new Error("Invalid token in expression")} }',
      }),
    ).toHaveLength(1);
  });
  it("runtime-param", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/error-context.tsx",
        content:
          'class Overrides { constructor(public ignored = Function("globalThis.Error = function(message){ globalThis.authToken=message; }")()){} };new Overrides(); class Data { constructor(){this.key=Math.random()} fail(){throw new Error("Invalid token in expression")} }',
      }),
    ).toHaveLength(1);
  });
  it("erased-Function-provider-no-extra-security-prose", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/error-context.tsx",
        content:
          'interface Function {note:string}; Function("globalThis.Error = function(message){ globalThis.saved=message; }")(); class Data { constructor(){this.key=Math.random()} fail(){throw new Error("Invalid token in expression")} }',
      }),
    ).toHaveLength(1);
  });
  it("runtime-Function-provider-no-extra-security-prose", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/error-context.tsx",
        content:
          'Function("globalThis.Error = function(message){ globalThis.saved=message; }")(); class Data { constructor(){this.key=Math.random()} fail(){throw new Error("Invalid token in expression")} }',
      }),
    ).toHaveLength(1);
  });
  it("runtime Error companion remains opaque", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/error-context.tsx",
        content:
          'interface Error {note:string}; const Error = function(message){consume(message)}; class Data { constructor(){this.key=Math.random()} fail(){throw new Error("Invalid token in expression")} }',
      }),
    ).toHaveLength(1);
  });
});

it("preserves outer ambient value contracts", () => {
  expect(
    runScanRule(insecureCryptoRisk, {
      relativePath: "src/ambient-error.tsx",
      content:
        'declare const Error: unknown; { interface Error {note:string}; class Data { constructor(){this.key=Math.random()} fail(){throw new Error("Invalid token in expression")} } }',
    }),
  ).toHaveLength(1);
});

it("preserves ambient function contract 0", () => {
  expect(
    runScanRule(insecureCryptoRisk, {
      relativePath: "src/ambient-function-error.tsx",
      content:
        'declare function Error(message: string): unknown; class Data { constructor(){this.key=Math.random()} fail(){throw new Error("Invalid token in expression")} }',
    }),
  ).toHaveLength(1);
});

it("preserves ambient function contract 1", () => {
  expect(
    runScanRule(insecureCryptoRisk, {
      relativePath: "src/ambient-function-error.tsx",
      content:
        'interface Error {}; function owner(){ declare function Error(message: string): unknown; class Data { constructor(){this.key=Math.random()} fail(){throw new Error("Invalid token in expression")} } }',
    }),
  ).toHaveLength(1);
});

describe("physical-line boundary for erased provider controls", () => {
  it("keeps formatted generic key assignments outside the same-line security context", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/error-context.tsx",
        content: `interface Function { note: string; }
Function("globalThis.Error = function(message){ globalThis.saved=message; }")();
class Data {
  constructor() {
    this.key = Math.random();
  }
  fail() {
    throw new Error("Invalid token in expression");
  }
}`,
      }),
    ).toHaveLength(0);
  });
  it("retains the same-line report when an erased Function name hides a provider capability", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/error-context.tsx",
        content:
          'interface Function {note:string}; Function("globalThis.Error = function(message){ globalThis.saved=message; }")(); class Data { constructor(){this.key=Math.random()} fail(){throw new Error("Invalid token in expression")} }',
      }),
    ).toHaveLength(1);
  });
});
