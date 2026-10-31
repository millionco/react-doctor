import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noImpureStateUpdater } from "./no-impure-state-updater.js";
import { noSideEffectInStateUpdaterFunction } from "./no-side-effect-in-state-updater-function.js";

for (const rule of [noImpureStateUpdater, noSideEffectInStateUpdaterFunction]) {
  describe(`${rule.id} Array.from result callbacks`, () => {
    it.each(["source", "[1]"])(
      "reports an effect in an unmodified native array mapper over %s",
      (source) => {
        const code = `import { useState } from "react";
        function Preview({ source }) {
          const [items, setItems] = useState([]);
          const update = () => {
            const incoming = Array.from(${source});
            if (incoming.length === 0) return;
            setItems(previous => previous.concat(incoming.map(item => {
              localStorage.setItem("entry", item);
              return item;
            })));
          };
          return <button onClick={update}>{items.length}</button>;
        }`;
        expect(runRule(rule, code).diagnostics).toHaveLength(1);
      },
    );

    it.each([
      "incoming.map = callback => [];",
      "incoming[method] = callback => [];",
      "Object.defineProperty(incoming, 'map', { value: callback => [] });",
      "Object.setPrototypeOf(incoming, custom);",
      "consume(incoming);",
      "const alias = incoming; alias.map = callback => [];",
      "incoming.push(1);",
    ])("preserves a changed or escaped result: %s", (change) => {
      const code = `import { useState } from "react";
        function Preview({ source, method, custom, consume }) {
          const [items, setItems] = useState([]);
          const incoming = Array.from(source);
          ${change}
          setItems(previous => incoming.map(item => { localStorage.setItem("entry", item); return item; }));
          return items;
        }`;
      expect(runRule(rule, code).diagnostics).toHaveLength(0);
    });

    it.each([
      "const Array = { from: source => source };",
      "Array.from = source => source;",
      "globalThis.Array.from = source => source;",
      "Object.assign(Array, { from: source => source });",
      "const Native = Array; Native.from = source => source;",
    ])("preserves a custom factory: %s", (change) => {
      expect(
        runRule(
          rule,
          `import { useState } from "react";
        ${change}
        function Preview({ source }) {
          const [items, setItems] = useState([]);
          const incoming = Array.from(source);
          setItems(previous => incoming.map(item => { localStorage.setItem("entry", item); return item; }));
          return items;
        }`,
        ).diagnostics,
      ).toHaveLength(0);
    });

    it.each([
      "incoming.map((item, index, collection) => { collection.map = () => []; return item; });",
      "incoming.map(function(item) { consume(arguments[2]); return item; });",
      "incoming.map(callback);",
      "incoming.map(item => item, incoming);",
    ])("preserves a callback that can expose the collection: %s", (operation) => {
      expect(
        runRule(
          rule,
          `import { useState } from "react";
        function Preview({ source, callback, consume }) {
          const [items, setItems] = useState([]);
          const incoming = Array.from(source);
          ${operation}
          setItems(previous => incoming.map(item => { localStorage.setItem("entry", item); return item; }));
          return items;
        }`,
        ).diagnostics,
      ).toHaveLength(0);
    });

    it("preserves a proven empty source and a deferred mapper body", () => {
      expect(
        runRule(
          rule,
          `import { useState } from "react";
        function Preview({ source }) {
          const [items, setItems] = useState([]);
          const empty = Array.from([]);
          const incoming = Array.from(source);
          setItems(previous => empty.map(item => { localStorage.setItem("entry", item); return item; }));
          setItems(previous => incoming.map(item => () => localStorage.setItem("entry", item)));
          return items;
        }`,
        ).diagnostics,
      ).toHaveLength(0);
    });

    it.each(["null", "undefined", "0", "false", "{}", "{ length: 0 }", "...[]", "[...[]]"])(
      "preserves unsupported or empty factory inputs: %s",
      (source) => {
        expect(
          runRule(
            rule,
            `import { useState } from "react";
          function Preview() {
            const [items, setItems] = useState([]);
            const incoming = Array.from(${source});
            setItems(previous => incoming.map(item => { localStorage.setItem("entry", item); return item; }));
            return items;
          }`,
          ).diagnostics,
        ).toHaveLength(0);
      },
    );

    it.each(["source = [];", "source.length = 0;"])(
      "preserves an input changed before conversion: %s",
      (change) => {
        expect(
          runRule(
            rule,
            `import { useState } from "react";
        function Preview({ source }) {
          const [items, setItems] = useState([]);
          ${change}
          const incoming = Array.from(source);
          setItems(previous => incoming.map(item => { localStorage.setItem("entry", item); return item; }));
          return items;
        }`,
          ).diagnostics,
        ).toHaveLength(0);
      },
    );

    it.each([
      "let incoming = Array.from(source); incoming = custom;",
      "const incoming = source;",
      "const incoming = custom.from(source);",
    ])("preserves uncertain provenance: %s", (declaration) => {
      expect(
        runRule(
          rule,
          `import { useState } from "react";
        function Preview({ source, custom }) {
          const [items, setItems] = useState([]);
          ${declaration}
          setItems(previous => incoming.map(item => { localStorage.setItem("entry", item); return item; }));
          return items;
        }`,
        ).diagnostics,
      ).toHaveLength(0);
    });
  });
}
