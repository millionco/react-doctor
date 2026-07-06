import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noRandomKey } from "./no-random-key.js";

describe("correctness/no-random-key regressions", () => {
  describe("deterministic function-local counters (mined markdown-renderer FP cluster)", () => {
    it("stays silent on a counter reset inside a render helper (renderInline shape)", () => {
      const result = runRule(
        noRandomKey,
        `const TOKEN_RE = /(\\*\\*[^*]+\\*\\*|\`[^\`]+\`)/g;

function renderInline(line: string) {
  const out = [];
  let key = 0;
  for (const match of line.matchAll(TOKEN_RE)) {
    const token = match[0];
    if (token.startsWith("**")) {
      out.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    } else {
      out.push(<code key={key++}>{token.slice(1, -1)}</code>);
    }
  }
  return out;
}
`,
        { filename: "src/markdown.tsx" },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("stays silent on a counter reset inside a component render (jaeger renderLines shape)", () => {
      const result = runRule(
        noRandomKey,
        `export function renderLines(metricsData: number[][]) {
  const graphs = [];
  let i = 0;

  metricsData.forEach((line) => {
    graphs.push(<Area key={i++} dataKey={String(line[0])} />);
  });

  return graphs;
}
`,
        { filename: "src/service-graph.tsx" },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("stays silent on a prefix-increment counter local to the component", () => {
      const result = runRule(
        noRandomKey,
        `export const List = ({ items }: { items: string[] }) => {
  let key = 0;
  return <ul>{items.map((item) => <li key={++key}>{item}</li>)}</ul>;
};
`,
        { filename: "src/list.tsx" },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("stays silent on a += counter local to the component", () => {
      const result = runRule(
        noRandomKey,
        `export const List = ({ items }: { items: string[] }) => {
  let key = 0;
  return <ul>{items.map((item) => <li key={(key += 1)}>{item}</li>)}</ul>;
};
`,
        { filename: "src/list.tsx" },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("still flags a module-scoped counter that survives across renders", () => {
      const result = runRule(
        noRandomKey,
        `let globalKey = 0;

export const List = ({ items }: { items: string[] }) => (
  <ul>{items.map((item) => <li key={globalKey++}>{item}</li>)}</ul>
);
`,
        { filename: "src/list.tsx" },
      );
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].message).toContain("globalKey++");
    });
  });

  describe("fresh calls nested inside the key expression (mined keyExtractor-fallback FN cluster)", () => {
    it("flags a Math.random() wrapped in String()", () => {
      const result = runRule(
        noRandomKey,
        `export const List = ({ items }: { items: string[] }) => (
  <ul>{items.map((item) => <li key={String(Math.random())}>{item}</li>)}</ul>
);
`,
        { filename: "src/list.tsx" },
      );
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].message).toContain("Math.random()");
    });

    it("flags a Math.random() fallback behind a logical or", () => {
      const result = runRule(
        noRandomKey,
        `interface Track {
  id?: string;
}

export const List = ({ tracks }: { tracks: Track[] }) => (
  <ul>
    {tracks.map((track) => (
      <li key={track.id || String(Math.random())}>{track.id}</li>
    ))}
  </ul>
);
`,
        { filename: "src/list.tsx" },
      );
      expect(result.diagnostics).toHaveLength(1);
    });

    it("stays silent on a callback stored in the key expression scope", () => {
      const result = runRule(
        noRandomKey,
        `export const List = ({ items, pick }: { items: string[]; pick: (make: () => number) => string }) => (
  <ul>{items.map((item) => <li key={pick(() => Math.random())}>{item}</li>)}</ul>
);
`,
        { filename: "src/list.tsx" },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });
  });
});
