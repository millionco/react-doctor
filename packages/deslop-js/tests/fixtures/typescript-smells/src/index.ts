interface Config {
  apiKey: string;
}

const rawConfig: unknown = { apiKey: "abc" };

const doubleAssertion = rawConfig as unknown as Config;

const escapeToAny = rawConfig as any;

const literalNonNull = "always-set"!;

const arrayNonNull = []!;

let mutableValue: string | undefined;
mutableValue = "ok";
const doubleNonNull = mutableValue!!;

const angleBracket = <Config>rawConfig;

const lazyAlpha = await import("./alpha.js");

import("./beta.js").then((module) => {
  console.log(module);
});

// @ts-ignore
const ignored: number = "string-value";

// @ts-expect-error
const expectErrorNoExplanation: number = "string-value";

// @ts-expect-error: alpha is dynamic; the cast is intentional
const expectErrorWithExplanation: number = "string-value";

const direct = require("./gamma.js");
const lazy = require("./delta.js");

module.exports = {
  doubleAssertion,
  escapeToAny,
  literalNonNull,
  arrayNonNull,
  doubleNonNull,
  angleBracket,
  lazyAlpha,
  ignored,
  expectErrorNoExplanation,
  expectErrorWithExplanation,
  direct,
  lazy,
};

exports.helper = (): number => 1;
