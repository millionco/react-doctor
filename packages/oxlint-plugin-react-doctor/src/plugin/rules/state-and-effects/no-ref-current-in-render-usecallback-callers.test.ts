import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noRefCurrentInRender } from "./no-ref-current-in-render.js";

describe("no-ref-current-in-render callback caller boundaries", () => {
  it.each([
    "resolveValue(); return null;",
    "(() => resolveValue())(); return null;",
    "(() => (() => resolveValue())())(); return null;",
    "(function resolveDuringRender() { resolveValue(); })(); return null;",
    "React.useState(() => resolveValue()); return null;",
    "React.useMemo(() => resolveValue(), []); return null;",
    "React.startTransition(() => resolveValue()); return null;",
    "React.useState.description = 'metadata'; React.useState(() => resolveValue()); return null;",
    "React.useMemo.description = 'metadata'; React.useMemo(() => resolveValue(), []); return null;",
    "React.useRef.description = 'metadata'; resolveValue(); return null;",
    "React.description = 'metadata'; resolveValue(); return null;",
    "if (enabled) resolveValue(); return null;",
  ])("reports a proven reachable caller: %s", (invocation) => {
    const result = runRule(
      noRefCurrentInRender,
      `import React from "react";
      function Panel({ value, enabled }) {
        const container = React.useRef(null);
        const resolveValue = React.useCallback(() => { container.current = value; }, []);
        ${invocation}
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    "return null; (() => resolveValue())();",
    "return null; (function Nested() { resolveValue(); })();",
    "throw Error(); (() => resolveValue())();",
    "return null; React.useState(() => resolveValue());",
    "return null; React.useMemo(() => resolveValue(), []);",
    "return null; React.startTransition(() => resolveValue());",
    "(() => { return; (() => resolveValue())(); })(); return null;",
    "React.useMemo(() => { return; (() => resolveValue())(); }, []); return null;",
    "if (false) (() => resolveValue())(); return null;",
    "if (0n) (() => resolveValue())(); return null;",
    "if (!true) resolveValue(); return null;",
    "if (1 === 2) resolveValue(); return null;",
    "const disabled = false; if (disabled) resolveValue(); return null;",
    "switch (1) { case 2: resolveValue(); break; } return null;",
    "switch (1) { case 1: resolveValue(); break; } return null;",
    "let active = false; while (active) { resolveValue(); active = false; } return null;",
    "for (let index = 0; index < 1; index++) resolveValue(); return null;",
    "for (const entry of values) resolveValue(); return null;",
    "for (const entry in values) resolveValue(); return null;",
    "do { resolveValue(); } while (false); return null;",
    "if (/pattern/) return null; else resolveValue(); return null;",
    "queue.map(() => resolveValue()); return null;",
    "queue.map(function Nested() { resolveValue(); }); return null;",
    "[1].map(() => resolveValue()); return null;",
    "new Promise(() => resolveValue()); return null;",
    "(() => { if (enabled) resolveValue(); })(); return null;",
    "React.useMemo(() => { if (enabled) resolveValue(); }, []); return null;",
    "((shouldResolve) => { if (shouldResolve) resolveValue(); })(false); return null;",
    "(function () { if (arguments.length) resolveValue(); })(); return null;",
    "(function () { if (this) resolveValue(); })(); return null;",
    "(async () => resolveValue())(); return null;",
    "(function* () { resolveValue(); })(); return null;",
    "React.useState = callback => { queue.push(callback); return [0, () => {}]; }; React.useState(() => resolveValue()); return null;",
    "React.useMemo = callback => { queue.push(callback); }; React.useMemo(() => resolveValue(), []); return null;",
    "React.startTransition = callback => { queue.push(callback); }; React.startTransition(() => resolveValue()); return null;",
    "Object.assign(React, { useState: callback => queue.push(callback) }); React.useState(() => resolveValue()); return null;",
    "const reactAlias = React; reactAlias.useState = callback => queue.push(callback); React.useState(() => resolveValue()); return null;",
    "const deferredQueue = { map(callback) { queue.push(callback); return []; } }; deferredQueue.map(() => resolveValue()); return null;",
    "Array.prototype.map = callback => { queue.push(callback); return []; }; [1].map(() => resolveValue()); return null;",
    "const entries = [1]; entries.map = callback => { queue.push(callback); return []; }; entries.map(() => resolveValue()); return null;",
  ])("does not follow an unreachable or unsupported caller: %s", (invocation) => {
    const result = runRule(
      noRefCurrentInRender,
      `import React from "react";
      function Panel({ value, enabled, queue, values }) {
        const container = React.useRef(null);
        const resolveValue = React.useCallback(() => { container.current = value; }, []);
        ${invocation}
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    "React.useRef = () => ({ current: null });",
    "Object.assign(React, { useRef: () => ({ current: null }) });",
    "const reactAlias = React; reactAlias.useRef = () => ({ current: null });",
  ])("requires a genuine ref initializer for a followed callback: %s", (replacement) => {
    const result = runRule(
      noRefCurrentInRender,
      `import React from "react";
      function Panel({ value }) {
        ${replacement}
        const container = React.useRef(null);
        const resolveValue = React.useCallback(() => { container.current = value; }, []);
        resolveValue();
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    "function () { if (arguments.length) container.current = value; }",
    "function () { if (this) container.current = value; }",
    "() => { if (arguments[0].enabled) container.current = value; }",
  ])("does not infer opaque callback inputs: %s", (callback) => {
    const result = runRule(
      noRefCurrentInRender,
      `import React from "react";
      function Panel({ value }) {
        const container = React.useRef(null);
        const resolveValue = React.useCallback(${callback}, []);
        resolveValue();
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not follow a conditional transitive wrapper call", () => {
    const result = runRule(
      noRefCurrentInRender,
      `import { useCallback, useRef } from "react";
      function Panel({ value, enabled }) {
        const container = useRef(null);
        const update = useCallback(() => { container.current = value; }, []);
        const resolveValue = useCallback(() => { if (enabled) update(); }, []);
        resolveValue();
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("reports closure-dependent writes inside a directly invoked callback", () => {
    const result = runRule(
      noRefCurrentInRender,
      `import { useCallback, useRef } from "react";
      function Panel({ value, enabled }) {
        const container = useRef(null);
        const resolveValue = useCallback(() => { if (enabled) container.current = value; }, []);
        resolveValue();
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    "initialize(() => resolveValue());",
    "calculate(() => resolveValue(), []);",
    "transition(() => resolveValue());",
    "initialize.description = 'metadata'; initialize(() => resolveValue());",
    "holder.description = 'metadata'; resolveValue();",
    "({ [holder]: property } = values); resolveValue();",
    "({ fallback = holder } = values); resolveValue();",
  ])("recognizes readonly imported API aliases: %s", (invocation) => {
    const result = runRule(
      noRefCurrentInRender,
      `import { useCallback, useRef as holder, useState as initialize, useMemo as calculate, startTransition as transition } from "react";
      function Panel({ value, values }) {
        let property, fallback;
        const container = holder(null);
        const resolveValue = useCallback(() => { container.current = value; }, []);
        ${invocation}
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    "mutate(React.useRef); resolveValue();",
    "mutate(React.useState); React.useState(() => resolveValue());",
    "mutate(React.useMemo); React.useMemo(() => resolveValue(), []);",
    "mutate(React.startTransition); React.startTransition(() => resolveValue());",
  ])("keeps escaped API method provenance quiet: %s", (invocation) => {
    const result = runRule(
      noRefCurrentInRender,
      `import React from "react";
      function Panel({ value, mutate }) {
        const container = React.useRef(null);
        const resolveValue = React.useCallback(() => { container.current = value; }, []);
        ${invocation}
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    "mutate(useRef); resolveValue();",
    "mutate(useState); useState(() => resolveValue());",
    "mutate(useMemo); useMemo(() => resolveValue(), []);",
    "mutate(startTransition); startTransition(() => resolveValue());",
  ])("keeps escaped named API provenance quiet: %s", (invocation) => {
    const result = runRule(
      noRefCurrentInRender,
      `import { useCallback, useRef, useState, useMemo, startTransition } from "react";
      function Panel({ value, mutate }) {
        const container = useRef(null);
        const resolveValue = useCallback(() => { container.current = value; }, []);
        ${invocation}
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    ["", "!true", 0],
    ["", "!false", 1],
    ["const enabled = false;", "enabled", 0],
    ["const enabled = true;", "enabled", 1],
    ["const disabled = false; const enabled = disabled;", "enabled", 0],
    ["const disabled = false; const enabled = disabled;", "!enabled", 1],
    ["const enabled = false; enabled = true;", "enabled", 0],
    ["const enabled = true; ({ [enabled]: spare } = {});", "enabled", 1],
    ["const enabled = true; ({ fallback: spare = enabled } = {});", "enabled", 1],
    ["", "1 === 2", 0],
    ["", "1 === 1", 0],
    ["", "1 - 1", 0],
    ["", "1 + 1", 0],
    ["", "false && value", 0],
    ["", "NaN", 0],
    ["", "Infinity", 0],
    ["const [enabled] = React.useState(false);", "enabled", 1],
    ["const [state] = React.useState(false); const enabled = state;", "enabled", 1],
    ["", "value", 1],
    ["", "value.enabled", 1],
  ])("bounds callback predicates: %s / %s", (setup, condition, expected) => {
    const result = runRule(
      noRefCurrentInRender,
      `import React from "react";
      function Panel({ value }) {
        let spare;
        ${setup}
        const container = React.useRef(null);
        const resolveValue = React.useCallback(() => {
          if (${condition}) container.current = value;
        }, []);
        resolveValue();
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });

  it("keeps a predicate declared after its callback reference unsupported", () => {
    const result = runRule(
      noRefCurrentInRender,
      `import React from "react";
      function Panel({ value }) {
        const container = React.useRef(null);
        const resolveValue = React.useCallback(() => { if (enabled) container.current = value; }, []);
        const enabled = true;
        resolveValue();
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not infer a render call from an unrelated nested component marker", () => {
    const result = runRule(
      noRefCurrentInRender,
      `import React from "react";
      function Panel({ value }) {
        const container = React.useRef(null);
        const resolveValue = React.useCallback(() => { container.current = value; }, []);
        const Unused = () => resolveValue();
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each(["async function", "function*"])(
    "does not infer a synchronous render from a named %s owner",
    (declaration) => {
      const result = runRule(
        noRefCurrentInRender,
        `import React from "react";
        ${declaration} Panel({ value }) {
          const container = React.useRef(null);
          const resolveValue = React.useCallback(() => { container.current = value; }, []);
          ${declaration === "async function" ? "await value;" : "yield value;"}
          resolveValue();
          return null;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    },
  );

  it("does not delegate a wrapper call to a different lexical component owner", () => {
    const result = runRule(
      noRefCurrentInRender,
      `import React from "react";
      function Panel({ value }) {
        const container = React.useRef(null);
        const update = React.useCallback(() => { container.current = value; }, []);
        const Nested = () => {
          const resolveValue = React.useCallback(() => update(), []);
          resolveValue();
          return null;
        };
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    "container = { current: null };",
    "[container] = [{ current: null }];",
    "({ container } = { container: { current: null } });",
    "for (container of [{ current: null }]) {}",
    "for (container in values) {}",
    "receiver = { current: null };",
    "[receiver] = [{ current: null }];",
    "({ receiver } = { receiver: { current: null } });",
    "for (receiver of [{ current: null }]) {}",
  ])("requires stable ref receivers and scalar aliases: %s", (replacement) => {
    const result = runRule(
      noRefCurrentInRender,
      `import { useCallback, useRef } from "react";
      function Panel({ value, values }) {
        let container = useRef(null);
        const receiver = container;
        ${replacement}
        const resolveValue = useCallback(() => { receiver.current = value; }, []);
        resolveValue();
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    "container.description = 'metadata';",
    "receiver.description = 'metadata';",
    "({ [container]: spare } = values);",
    "({ [receiver]: spare } = values);",
    "({ fallback: spare = container } = values);",
    "({ fallback: spare = receiver } = values);",
  ])("retains stable let ref roots and const aliases through reads: %s", (statement) => {
    const result = runRule(
      noRefCurrentInRender,
      `import { useCallback, useRef } from "react";
      function Panel({ value, values }) {
        let spare;
        let container = useRef(null);
        const receiver = container;
        ${statement}
        const resolveValue = useCallback(() => { receiver.current = value; }, []);
        resolveValue();
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not trace an ordinary object substituted before creating its receiver alias", () => {
    const result = runRule(
      noRefCurrentInRender,
      `import { useCallback, useRef } from "react";
      function Panel({ value }) {
        let container = useRef(null);
        container = { current: null };
        const receiver = container;
        const resolveValue = useCallback(() => { receiver.current = value; }, []);
        resolveValue();
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not follow a child callback that captures a different lexical ref owner", () => {
    const result = runRule(
      noRefCurrentInRender,
      `import React from "react";
      const Panel = ({ value }) => {
        const container = React.useRef(null);
        const Unused = () => {
          const resolveValue = React.useCallback(() => { container.current = value; }, []);
          resolveValue();
          return null;
        };
        return null;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    "switch (1) { case 2: container.current = value; break; }",
    "switch (1) { case 1: container.current = value; break; }",
    "let active = false; while (active) { container.current = value; active = false; }",
    "for (const entry of values) container.current = value;",
    "do { container.current = value; } while (false);",
  ])("keeps switch and loop target bodies unsupported: %s", (body) => {
    const result = runRule(
      noRefCurrentInRender,
      `import { useCallback, useRef } from "react";
      function Panel({ value, values }) {
        const container = useRef(null);
        const resolveValue = useCallback(() => { ${body} }, []);
        resolveValue();
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
