import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { jsxCurlyBracePresence } from "./jsx-curly-brace-presence.js";

describe("react-builtins/jsx-curly-brace-presence comment boundaries", () => {
  it.each([
    '<a href={"https://example.com/path"} />',
    '<img src={"//cdn.example.com/image.png"} />',
    '<p>{"https://example.com"}</p>',
    "<a href={`https://example.com`} />",
    '<div>{<a href="https://example.com" />}</div>',
    "<div>{<>https://example.com</>}</div>",
    '<a href={"https://example.com/é"} />',
  ])("reports literal braces around comment-like text: %s", (code) => {
    const result = runRule(jsxCurlyBracePresence, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    '<a href={/* keep origin */ "https://example.com"} />',
    '<a href={"https://example.com" /* keep origin */} />',
    `<p>{
      // keep origin
      "https://example.com"
    }</p>`,
    `<p>{"https://example.com" // keep origin
    }</p>`,
    '<a href={/* keep origin */ "https://example.com/é" /* keep note */} />',
    "<div>{/* https://example.com */}</div>",
    "<App>{<Component>{/* keep */}</Component>}</App>",
    '<App>{<Component href="https://example.com">{/* keep */}</Component>}</App>',
    "<App>{<Component href={`https://${/* keep */ host}`} />}</App>",
    '<App>{<Component>{"https://example.com"}{/* keep */}</Component>}</App>',
    '<p>{"/* display text */"}</p>',
  ])("preserves actual comments and existing literal exceptions: %s", (code) => {
    const result = runRule(jsxCurlyBracePresence, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each(['<a href={"https://example.com"} />', '<p>{"https://example.com"}</p>'])(
    "preserves configured ignore modes: %s",
    (code) => {
      const result = runRule(jsxCurlyBracePresence, code, {
        settings: {
          "react-doctor": { jsxCurlyBracePresence: "ignore" },
        },
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    },
  );
});
