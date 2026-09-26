import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noSelfUpdatingEffect } from "./no-self-updating-effect.js";

const carousel = (
  body: string,
  setup = "",
  parameters = "{ text, replace }: { text: string; replace: boolean }",
) => `
import { useState, useEffect, useRef } from "react";
function Carousel(${parameters}) {
  const [items, setItems] = useState([{ text, id: 0 }]);
  const nextId = useRef(1);
  ${setup}
  useEffect(() => {
    const current = items[items.length - 1];
    ${body}
  }, [text, items]);
  return null;
}`;

const guardedAppend = `
  if (text === current.text) return;
  if (replace) {
    setItems([{ text, id: current.id }]);
    return;
  }
  const id = nextId.current++;
  setItems(previous => [...previous.slice(-1), { text, id }]);
`;

describe("no-self-updating-effect: convergent-effect tail equality", () => {
  it.each([
    guardedAppend,
    `${guardedAppend}
      const timeout = setTimeout(() => setItems(previous => previous.slice(-1)), 350);
      return () => clearTimeout(timeout);`,
    `if (current.text === text) { return; }
      setItems([{ text }]);`,
    `if ((current as { text: string })["text"] === (text as string)) return;
      setItems(previous => ([...previous, { ["text"]: text }] as typeof previous));`,
    `if (text === items[items.length - 1].text) return;
      setItems(previous => { return [...previous, { text }]; });`,
    `const latest = current;
      if (latest.text === text) return;
      setItems([{ ...current, text }]);`,
  ])("accepts synchronous establishment and tail-preserving trims: %s", (body) => {
    const result = runRule(noSelfUpdatingEffect, carousel(body), { filename: "carousel.tsx" });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    `setItems(previous => [...previous, { text }]);`,
    `if (text === unrelated.text) return;
      setItems(previous => [...previous, { text }]);`,
    `if (text === current.other) return;
      setItems(previous => [...previous, { text }]);`,
    `if (text === current.text) return;
      setItems(previous => [...previous, { text: text + "!" }]);`,
    `if (text === current.text) return;
      if (replace) setItems([{ text: "other" }]);
      setItems(previous => [...previous, { text }]);`,
    `if (text === current.text) return;
      setItems(previous => replace ? [...previous, { text }] : [...previous]);`,
    `if (text === current.text) return;
      setItems(previous => { if (replace) return [...previous]; return [{ text }]; });`,
    `${guardedAppend} setTimeout(() => setItems([{ text: "stale" }]), 350);`,
    `${guardedAppend} setTimeout(() => setItems([{ text }]), 350);`,
    `${guardedAppend} setTimeout(() => setItems(previous => previous.slice(0, -1)), 350);`,
    `${guardedAppend} setTimeout(() => setItems(() => items.slice(-1)), 350);`,
    `if (text === current.text) return;
      if (replace) { setItems([{ text }]); return; }
      setItems(previous => previous.slice(-1));`,
    `${guardedAppend} queueMicrotask(() => setItems([{ text }]));`,
    `${guardedAppend} const update = () => setItems([{ text }]); update();`,
    `${guardedAppend} const write = setItems; write([]);`,
    `setItems([]);
      if (text === current.text) return;
      setItems(previous => [...previous, { text }]);`,
    `if (text === current.text) { setItems([]); return; }
      setItems(previous => [...previous, { text }]);`,
    `if (text === current.text) return;
      setItems(previous => [...previous, { text, ...unknown }]);`,
    `if (text === current.text) return;
      setItems(previous => [...previous, { text, [key]: "other" }]);`,
    `if (text === current.text) return;
      setItems(previous => [...previous, { text }, ...unknown]);`,
    `if (text === current.text) return;
      setItems(text => [{ text }]);`,
    `if (text === current.text) return;
      setItems(previous => [...previous, { get text() { return text; } }]);`,
    `if (text === current.text) return;
      const id = (text = "changed");
      setItems(previous => [...previous, { text, id }]);`,
    `if (text === current.text) return;
      current.text = "other";
      setItems(previous => [...previous, { text }]);`,
    `if (text === current.text) return;
      mutate(current);
      setItems(previous => [...previous, { text }]);`,
    `if (text === current.text) return;
      items.pop();
      setItems(previous => [...previous, { text }]);`,
    `if (text === current.text) return;
      setItems(async previous => [...previous, { text }]);`,
    `if (text === current.text) return;
      setItems(function* () { return [{ text }]; });`,
  ])("retains diagnostics when convergence is unproven: %s", (body) => {
    const result = runRule(noSelfUpdatingEffect, carousel(body), { filename: "carousel.tsx" });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    ["const text = String(items.length);", "{ replace }"],
    ["const text = Math.random();", "{ replace }"],
    ["", "{ text = String(Math.random()), replace }: { text?: string; replace: boolean }"],
    ["", "{ text, replace }: { text: number; replace: boolean }"],
  ])("rejects targets that can change or fail reflexive equality: %s", (setup, parameters) => {
    const result = runRule(noSelfUpdatingEffect, carousel(guardedAppend, setup, parameters), {
      filename: "carousel.tsx",
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("retains a derived target that changes with the written dependency", () => {
    const result = runRule(
      noSelfUpdatingEffect,
      `import { useState, useEffect } from "react";
      function Carousel() {
        const [items, setItems] = useState([{ text: "" }]);
        const text: string = String(items.length);
        useEffect(() => {
          const current = items[items.length - 1];
          if (text === current.text) return;
          setItems(previous => [...previous, { text }]);
        }, [items, text]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not suppress another self-updating dependency", () => {
    const result = runRule(
      noSelfUpdatingEffect,
      carousel(
        `${guardedAppend} setCount(count + 1);`,
        "const [count, setCount] = useState(0);",
      ).replace("[text, items]", "[text, items, count]"),
      { filename: "carousel.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("setCount()");
  });
});
