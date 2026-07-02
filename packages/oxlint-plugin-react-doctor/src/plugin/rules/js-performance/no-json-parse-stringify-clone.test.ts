import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noJsonParseStringifyClone } from "./no-json-parse-stringify-clone.js";

describe("no-json-parse-stringify-clone", () => {
  it("flags `JSON.parse(JSON.stringify(obj))`", () => {
    const result = runRule(
      noJsonParseStringifyClone,
      `const copy = JSON.parse(JSON.stringify(state));`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("structuredClone");
  });

  it("flags the clone even when a replacer/reviver reference is passed", () => {
    const result = runRule(
      noJsonParseStringifyClone,
      `const copy = JSON.parse(JSON.stringify(state, replacer), reviver);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  // RDE (AFFiNE `cleanObject`): an inline function replacer transforms/filters
  // the output, so `structuredClone` is not an equivalent rewrite — don't flag.
  it("does not flag when a function replacer transforms the output", () => {
    const result = runRule(
      noJsonParseStringifyClone,
      `const clean = JSON.parse(JSON.stringify(obj, (k, v) => (keep(k) ? v : undefined)));`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when an array (allowlist) replacer is passed", () => {
    const result = runRule(
      noJsonParseStringifyClone,
      `const picked = JSON.parse(JSON.stringify(obj, ["id", "name"]));`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag `JSON.stringify(JSON.parse(str))` (normalization, not a clone)", () => {
    const result = runRule(noJsonParseStringifyClone, `const s = JSON.stringify(JSON.parse(raw));`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a plain `JSON.parse(str)`", () => {
    const result = runRule(noJsonParseStringifyClone, `const data = JSON.parse(raw);`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag `JSON.parse` of a non-stringify call", () => {
    const result = runRule(noJsonParseStringifyClone, `const data = JSON.parse(readFile());`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a non-JSON object with parse/stringify methods", () => {
    const result = runRule(noJsonParseStringifyClone, `const x = YAML.parse(YAML.stringify(obj));`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag passing `JSON.stringify` as a reference (not called)", () => {
    const result = runRule(noJsonParseStringifyClone, `const fn = JSON.parse(JSON.stringify);`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a clone directly inside a snapshot* helper (persistence exemption)", () => {
    const result = runRule(
      noJsonParseStringifyClone,
      `function snapshotState(state) { return JSON.parse(JSON.stringify(state)); }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  // The nearest NAMED enclosing function decides the exemption: a helper
  // bound to a `clone`-named binding is exactly the deep clone the rule
  // redirects, even when a snapshot* function encloses it.
  it("flags a clone-named nested helper even inside a snapshot* function", () => {
    const result = runRule(
      noJsonParseStringifyClone,
      `function takeSnapshot(state) { const clone = () => JSON.parse(JSON.stringify(state)); return clone(); }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a clone in an ANONYMOUS callback inside a snapshot* helper", () => {
    const result = runRule(
      noJsonParseStringifyClone,
      `function snapshotEntries(items) { return items.map((item) => JSON.parse(JSON.stringify(item))); }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a clone inside a nested helper within a NON-snapshot function", () => {
    const result = runRule(
      noJsonParseStringifyClone,
      `function build(state) { const clone = () => JSON.parse(JSON.stringify(state)); return clone(); }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  // A `Snapshot*`-named React COMPONENT is not a persistence helper: a plain
  // deep clone in one of its handlers is a true positive.
  it("flags a plain deep clone inside a Snapshot*-named component handler", () => {
    const result = runRule(
      noJsonParseStringifyClone,
      `
      function SnapshotList({ items, onDuplicate }) {
        const handleDuplicate = (item) => {
          const copy = JSON.parse(JSON.stringify(item));
          onDuplicate(copy);
        };
        return items.map((item) => (
          <button key={item.id} onClick={() => handleDuplicate(item)}>dup</button>
        ));
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag when an inline function reviver transforms the parsed values", () => {
    const result = runRule(
      noJsonParseStringifyClone,
      `
      const revived = JSON.parse(
        JSON.stringify(payload),
        (key, value) => (typeof value === "string" && ISO_DATE.test(value) ? new Date(value) : value),
      );
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags when the replacer slot is a null literal (pretty-print clone)", () => {
    const result = runRule(
      noJsonParseStringifyClone,
      `const copy = JSON.parse(JSON.stringify(state, null, 2));`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  // sofn-xyz/mailing settings: both
  // mined clones inside getServerSideProps props MUST keep firing.
  it("flags both clones in a getServerSideProps props object", () => {
    const result = runRule(
      noJsonParseStringifyClone,
      `
      export const getServerSideProps = withSessionSsr(async ({ req }) => {
        const apiKeys = await prisma.apiKey.findMany();
        const lists = await prisma.list.findMany();
        return {
          props: {
            user: req.session.user,
            apiKeys: JSON.parse(JSON.stringify(apiKeys)),
            lists: JSON.parse(JSON.stringify(lists)),
          },
        };
      });
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });
});
