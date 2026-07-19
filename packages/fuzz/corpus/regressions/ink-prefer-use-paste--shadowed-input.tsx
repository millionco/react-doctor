// rule: ink-prefer-use-paste
// weakness: alias-guard
// source: adversarial audit of PR 1404 nested callback scope
import { useInput } from "ink";

export const App = () => {
  useInput((input) => {
    ["a"].some((input) => input.includes("\n"));
    if (input.length >= 1) consume(input);
  });
  return null;
};
