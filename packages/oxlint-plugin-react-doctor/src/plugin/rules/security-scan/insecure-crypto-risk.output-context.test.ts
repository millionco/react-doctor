import { describe, expect, it } from "vite-plus/test";
import { runScanRule } from "../../../test-utils/run-scan-rule.js";
import { insecureCryptoRisk } from "./insecure-crypto-risk.js";

describe("insecure-crypto-risk Error prose output context", () => {
  it.each([
    'function next(){return Math.random()} function parse(){throw new Error("Invalid token")}\nconst sessionToken=next();',
    'function next(){const value=Math.random();return value} function parse(){throw new Error("Invalid token")}\nconst sessionToken=next();',
    'const next=()=>{return Math.random()};function parse(){throw new Error("Invalid token")}\nconst sessionToken=next();',
    'const next=()=>Math.random();function parse(){throw new Error("Invalid token")}\nconst sessionToken=next();',
    'function next(){return Math.random()} function parse(){throw new Error("Invalid token")}\noutput.secret=next();',
    'function next(){return Math.random()} function parse(){throw new Error("Invalid token")}\nissueToken(next());',
    'function next(){return Math.random()} function parse(){throw new Error("Invalid token")}\nconst alias=next;const sessionToken=alias();',
    'export class Sequence{value=0;constructor(){this.value=Math.random()}parse(){throw new Error("Invalid token")}}\nconst sessionToken=new Sequence().value;',
    'class Sequence{value=0;constructor(){this.value=Math.random()}parse(){throw new Error("Invalid token")}}\nconst Alias=Sequence;const sessionToken=new Alias().value;',
    'class Sequence{value=0;constructor(){this.value=Math.random()}parse(){throw new Error("Invalid token")}}\nissueToken(new Sequence().value);',
    'function next(){return Math.random()} function parse(){throw new Error("Invalid token")}\nconst result={sessionToken:next()};',
    'class Sequence{value=0;constructor(){this.value=Math.random()}parse(){throw new Error("Invalid token")}}\nexport const issue=()=>({sessionToken:new Sequence().value});',
    'class Sequence{value="fixed";constructor(){this.value=Math.random()}parse(){throw new Error("Invalid token")}}\nconst sessionToken=new Sequence().value;',
    'function next(){const value=Math.random();const alias=value;return alias} function parse(){throw new Error("Invalid token")}\nconst sessionToken=next();',
    'Object.defineProperty(Object.prototype,"value",{get(){return "fixed"},set(input){}});class Sequence{value=0;constructor(){this.value=Math.random()}parse(){throw new Error("Invalid token")}}\nconst sessionToken=new Sequence().value;',
  ])("retains a finding for a visible security output consumer: %s", (content) => {
    expect(
      runScanRule(insecureCryptoRisk, { relativePath: "src/random-source.ts", content }),
    ).toEqual([
      {
        message:
          "Code uses weak hashes, deprecated ciphers, timing-unsafe comparisons, or Math.random in a security-shaped context.",
        line: 1,
        column: content.indexOf("Math.random") + 1,
      },
    ]);
  });

  it.each([
    'export function next(){return Math.random()} function parse(){throw new Error("Invalid token")}',
    'export const next=()=>{return Math.random()};function parse(){throw new Error("Invalid token")}',
    'export const next=()=>Math.random();function parse(){throw new Error("Invalid token")}',
    'function next(){return Math.random()} function parse(){throw new Error("Invalid token")}\nconsume(next);',
    'export class Sequence{constructor(){this.value=Math.random()}parse(){throw new Error("Invalid token")}}',
    'export default class Sequence{constructor(){this.value=Math.random()}parse(){throw new Error("Invalid token")}}',
    'class Sequence{constructor(){this.value=Math.random()}parse(){throw new Error("Invalid token")}}\nexport {Sequence};',
    'class Sequence{constructor(){this.value=Math.random()}parse(){throw new Error("Invalid token")}}\nconsume(new Sequence().value);',
    'class Sequence{constructor(){this.value=Math.random()}parse(){throw new Error("Invalid token")}}\nconst sequence=new Sequence();consume(sequence.value);export {sequence};',
    'class Sequence{constructor(){this.value=Math.random()}parse(){throw new Error("Invalid token")}}\nconst sessionToken=new Sequence().other;',
    'function next(){Math.random();return "fixed"} function parse(){throw new Error("Invalid token")}\nconst sessionToken=next();',
    'function next(){const value=Math.random();return "fixed"} function parse(){throw new Error("Invalid token")}\nconst sessionToken=next();',
    'function next(){return (Math.random(),"fixed")} function parse(){throw new Error("Invalid token")}\nconst sessionToken=next();',
    'function next(){return Math.random()} function parse(){throw new Error("Invalid token")}\nconst sessionToken=(next(),"fixed");',
    'class Sequence{constructor(){this.value=(Math.random(),"fixed")}parse(){throw new Error("Invalid token")}}\nconst sessionToken=new Sequence().value;',
    'class Sequence{constructor(){this.value=Math.random()}parse(){throw new Error("Invalid token")}}\nconst sessionToken=(new Sequence().value="fixed");',
    'function next(){return Math.random()} function parse(){throw new Error("Invalid token")}\nconst result={[sessionToken]:next()};',
    'function next(){return Math.random()} function parse(){throw new Error("Invalid token")}\noutput[sessionToken]=next();',
    'class Sequence{shuffle(){this.value=Math.random()}parse(){throw new Error("Invalid token")}}\nconst sessionToken=new Sequence().value;',
    'const next=(()=>{return Math.random()})();function parse(){throw new Error("Invalid token")}\nconst sessionToken=next();',
    'class Sequence{value=0;constructor(){this.value=Math.random();this.value="fixed"}parse(){throw new Error("Invalid token")}}\nconst sessionToken=new Sequence().value;',
    'class Sequence{value=0;constructor(){this.value=Math.random();return {value:"fixed"}}parse(){throw new Error("Invalid token")}}\nconst sessionToken=new Sequence().value;',
    'class Sequence{constructor(){this.value=Math.random()}get value(){return "fixed"}set value(input){}parse(){throw new Error("Invalid token")}}\nconst sessionToken=new Sequence().value;',
    'class Parent{get value(){return "fixed"}set value(input){}}class Sequence extends Parent{constructor(){super();this.value=Math.random()}parse(){throw new Error("Invalid token")}}\nconst sessionToken=new Sequence().value;',
    'function next(){let value=Math.random();value="fixed";return value} function parse(){throw new Error("Invalid token")}\nconst sessionToken=next();',
    'function next(){return Math.random()} function parse(){throw new Error("Invalid token")}\nlet alias=next;alias=()=>"fixed";const sessionToken=alias();',
    'let next=()=>Math.random();function parse(){throw new Error("Invalid token")}\nnext=()=>"fixed";const sessionToken=next();',
    'function next(){const value=Math.random();let alias=value;alias="fixed";return alias} function parse(){throw new Error("Invalid token")}\nconst sessionToken=next();',
    'function next(){return Math.random()} function parse(){throw new Error("Invalid token")}\nnext=()=>"fixed";const alias=next;const sessionToken=alias();',
    'class Sequence{constructor(){this.value=Math.random()}parse(){throw new Error("Invalid token")}}\nSequence=class{value="fixed"};const Alias=Sequence;const sessionToken=new Alias().value;',
    'function next(){const value=Math.random();function read(){return value}read=()=>"fixed";return read()} function parse(){throw new Error("Invalid token")}\nconst sessionToken=next();',
    'function next(){try{return Math.random()}finally{throw new Error("stopped")}} function parse(){throw new Error("Invalid token")}\nconst sessionToken=next();',
    'function next(){const value=Math.random();throw "stop";return value} function parse(){throw new Error("Invalid token")}\nconst sessionToken=next();',
    'class Sequence{constructor(){this.value=Math.random()}parse(){throw new Error("Invalid token")}}\nObject.defineProperty(Sequence.prototype,"value",{get(){return "fixed"},set(input){}});const sessionToken=new Sequence().value;',
    'class Sequence{constructor(){this.__proto__=Math.random()}parse(){throw new Error("Invalid token")}}\nconst sessionToken=new Sequence().__proto__;',
    'class Sequence{constructor(){this.value=Math.random()}parse(){throw new Error("Invalid token")}}\nconst Alias=Sequence;Object.defineProperty(Alias.prototype,"value",{get(){return "fixed"},set(input){}});const sessionToken=new Alias().value;',
    'class Sequence{constructor(){this.value=Math.random()}parse(){throw new Error("Invalid token")}}\nconst previous=new Sequence();Object.defineProperty(Object.getPrototypeOf(previous),"value",{get(){return "fixed"},set(input){}});const sessionToken=new Sequence().value;',
    'Object.defineProperty(Object.prototype,"value",{get(){return "fixed"},set(input){}});class Sequence{constructor(){this.value=Math.random()}parse(){throw new Error("Invalid token")}}\nconst sessionToken=new Sequence().value;',
    'class Sequence{constructor(){this.value=Math.random()}parse(){throw new Error("Invalid token")}}\nconst sessionToken=new Sequence().value;',
    'class Sequence{declare value:number;constructor(){this.value=Math.random()}parse(){throw new Error("Invalid token")}}\nconst sessionToken=new Sequence().value;',
  ])("preserves unrelated Error prose when a security output is unproved: %s", (content) => {
    expect(
      runScanRule(insecureCryptoRisk, { relativePath: "src/random-source.ts", content }),
    ).toEqual([]);
  });
});
