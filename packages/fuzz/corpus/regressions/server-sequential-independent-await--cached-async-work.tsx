// rule: server-sequential-independent-await
// verdict: pass
// weakness: alias-guard
// source: same-file variant of FP 2bacf0aa5ac16a08a2702279800d56b01ead8890f3725cc9b6e46189b77b0d82; imported formatter remains unsupported
import { getStack } from "./context";

const getStackContext = async (element: Element) => {
  const stack = await getStack(element);
  return String(stack);
};

export const describeElement = async (element: Element) => {
  const [stack] = await Promise.all([getStack(element).then((value) => value ?? [])]);
  const context = await getStackContext(element);
  return { stack, context };
};

const promises = new WeakMap<object, Promise<string>>();
const read = (key: object) => {
  const cached = promises.get(key);
  if (cached) return cached;
  const promise = fetch("/value").then((response) => response.text());
  promises.set(key, promise);
  return promise;
};
const format = async (target: object) => {
  const value = await read(target);
  return value.toUpperCase();
};

export const describeLocal = async (element: object) => {
  const alias = element;
  const [value] = await Promise.all([read(alias)]);
  const text = await format(element);
  return { value, text };
};
