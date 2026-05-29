import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noRandomKey } from "./no-random-key.js";

describe("no-random-key", () => {
  it("flags key={Math.random()}", () => {
    const result = runRule(
      noRandomKey,
      `
      function List({ items }) {
        return (
          <ul>
            {items.map((item) => (
              <li key={Math.random()}>{item}</li>
            ))}
          </ul>
        );
      }
    `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("Math.random()");
  });

  it("flags key={Date.now()}", () => {
    const result = runRule(
      noRandomKey,
      `
      function List({ items }) {
        return items.map((item) => <Row key={Date.now()} text={item} />);
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("Date.now()");
  });

  it("flags key={crypto.randomUUID()}", () => {
    const result = runRule(
      noRandomKey,
      `
      function List({ items }) {
        return items.map((item) => <Row key={crypto.randomUUID()} text={item} />);
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("crypto.randomUUID()");
  });

  it("flags key={nanoid()}", () => {
    const result = runRule(
      noRandomKey,
      `
      import { nanoid } from "nanoid";

      function List({ items }) {
        return items.map((item) => <Row key={nanoid()} text={item} />);
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("nanoid()");
  });

  it("flags key={uuidv4()}", () => {
    const result = runRule(
      noRandomKey,
      `
      import { v4 as uuidv4 } from "uuid";

      function List({ items }) {
        return items.map((item) => <Row key={uuidv4()} text={item} />);
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags key={performance.now()}", () => {
    const result = runRule(
      noRandomKey,
      `
      function List({ items }) {
        return items.map((item) => <Row key={performance.now()} text={item} />);
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("performance.now()");
  });

  it("flags key={new Date()} (using Date.now-style coercion)", () => {
    const result = runRule(
      noRandomKey,
      `
      function List({ items }) {
        return items.map((item) => <Row key={new Date()} text={item} />);
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a prefix UpdateExpression counter key", () => {
    const result = runRule(
      noRandomKey,
      `
      function List({ items }) {
        let counter = 0;
        return items.map((item) => <Row key={++counter} text={item} />);
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("++counter");
  });

  it("flags a postfix UpdateExpression counter key", () => {
    const result = runRule(
      noRandomKey,
      `
      function List({ items }) {
        let counter = 0;
        return items.map((item) => <Row key={counter++} text={item} />);
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("counter++");
  });

  it("uses the actual variable name in the diagnostic, not a hardcoded 'counter'", () => {
    const result = runRule(
      noRandomKey,
      `
      function List({ items }) {
        let id = 0;
        return items.map((item) => <Row key={++id} text={item} />);
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("++id");
  });

  it("does not flag stable item-id keys", () => {
    const result = runRule(
      noRandomKey,
      `
      function List({ items }) {
        return items.map((item) => <Row key={item.id} text={item.text} />);
      }
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag template-literal keys built from item props", () => {
    const result = runRule(
      noRandomKey,
      `
      function List({ items }) {
        return items.map((item) => (
          <Row key={\`row-\${item.id}\`} text={item.text} />
        ));
      }
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag user-defined getKey(item) helpers", () => {
    const result = runRule(
      noRandomKey,
      `
      function List({ items, getKey }) {
        return items.map((item) => <Row key={getKey(item)} text={item.text} />);
      }
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag attributes other than `key`", () => {
    const result = runRule(
      noRandomKey,
      `
      function List({ items }) {
        return items.map((item, i) => (
          <Row key={item.id} id={Math.random()} text={item.text} />
        ));
      }
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a user-defined createId() that shadows the id-library name", () => {
    const result = runRule(
      noRandomKey,
      `
      function createId(item) {
        return item.slug;
      }

      function List({ items }) {
        return items.map((item) => <Row key={createId(item)} text={item.text} />);
      }
    `,
    );

    // \`createId\` here is a stable, user-defined helper — not the
    // fresh-each-call id factory from a library import.
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a user-defined const v4 arrow that shadows the id-library name", () => {
    const result = runRule(
      noRandomKey,
      `
      const v4 = (item) => item.slug;

      function List({ items }) {
        return items.map((item) => <Row key={v4(item)} text={item.text} />);
      }
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("still flags an unresolved bare id factory (likely a missing import / global)", () => {
    const result = runRule(
      noRandomKey,
      `
      function List({ items }) {
        return items.map((item) => <Row key={nanoid()} text={item.text} />);
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });
});
