import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noArrayIndexAsKey } from "./no-array-index-as-key.js";

const renderers = [
  {
    name: "stock memo nested native renderer",
    source: `import { memo } from "react";

export const CaptionFooter = memo(function CaptionFooter() {
  return (
    <footer>
      {Array.from(Array(2), (_unused, i) => (
        <div key={i}>
          Caption {i + 1}
          <ul>{Array.from(Array(2), (_unusedInner, j) => <li key={j}>{\`Link \${i + 1}.\${j + 1}\`}</li>)}</ul>
        </div>
      ))}
    </footer>
  );
});
`,
    count: 0,
  },
  {
    name: "private plain renderer jsx only",
    source: `import * as React from "react";

function CaptionFooter() {
  return (
    <footer>{Array.from(Array(2), (_unused, i) => <input key={i} defaultValue={\`fixed-\${i}\`} />)}</footer>
  );
}

export function App() {
  return <CaptionFooter />;
}
`,
    count: 0,
  },
  {
    name: "direct native count and ordinal",
    source: `import * as React from "react";
export function Footer() {
  return <footer>{Array.from(Array(6), (unused, i) => <div key={i}><a href={\`/footer-link-\${i + 1}\`}>Footer {i + 1}</a></div>)}</footer>;
}
`,
    count: 1,
  },
  {
    name: "real per index prop row",
    source: `import * as React from "react";
export function Footer({ rows }: { rows: { label: string }[] }) {
  return <footer>{Array.from(Array(6), (unused, i) => <input key={i} defaultValue={rows[i].label} />)}</footer>;
}
`,
    count: 1,
  },
  {
    name: "reflective prototype alias",
    source: `import * as React from "react";
declare const replacement: typeof Array.prototype[typeof Symbol.iterator];
const proto = Object.getPrototypeOf([]);
proto[Symbol.iterator] = replacement;
export function Footer() {
  return <footer>{Array.from(Array(6), (unused, i) => <div key={i}><a href={\`/footer-link-\${i + 1}\`}>Footer {i + 1}</a></div>)}</footer>;
}
`,
    count: 1,
  },
  {
    name: "alternate single host returns",
    source: `import * as React from "react";

export function Footer({ left }: { left: boolean }) {
  if (left) {
    return (
      <footer>{Array.from(Array(2), (_unused, i) => <input key={i} defaultValue={\`left-\${i}\`} />)}</footer>
    );
  }
  return (
    <footer>{Array.from(Array(2), (_unused, i) => <input key={i} defaultValue={\`right-\${i}\`} />)}</footer>
  );
}
`,
    count: 2,
  },
  {
    name: "opaque jsx attribute pools",
    source: `import * as React from "react";

function Choose({ first, second, left }: {
  first: React.ReactElement;
  second: React.ReactElement;
  left: boolean;
}) {
  const selected = left ? first : second;
  return <footer>{selected.props.children}</footer>;
}

export function Footer({ left }: { left: boolean }) {
  return (
    <Choose
      left={left}
      first={<div>{Array.from(Array(2), (_unused, i) => <input key={i} defaultValue={\`left-\${i}\`} />)}</div>}
      second={<div>{Array.from(Array(2), (_unused, i) => <input key={i} defaultValue={\`right-\${i}\`} />)}</div>}
    />
  );
}
`,
    count: 2,
  },
  {
    name: "memo renderer type extraction",
    source: `import { memo } from "react";

const Left = memo(function Left() {
  return (
    <footer>{Array.from(Array(2), (_unused, i) => <input key={i} defaultValue={\`left-\${i}\`} />)}</footer>
  );
});

const Right = memo(function Right() {
  return (
    <footer>{Array.from(Array(2), (_unused, i) => <input key={i} defaultValue={\`right-\${i}\`} />)}</footer>
  );
});

export function Footer({ left }: { left: boolean }) {
  return left ? (Left as any).type() : (Right as any).type();
}
`,
    count: 2,
  },
  {
    name: "plain renderer direct extraction",
    source: `import * as React from "react";

function Left() {
  return (
    <footer>{Array.from(Array(2), (_unused, i) => <input key={i} defaultValue={\`left-\${i}\`} />)}</footer>
  );
}

function Right() {
  return (
    <footer>{Array.from(Array(2), (_unused, i) => <input key={i} defaultValue={\`right-\${i}\`} />)}</footer>
  );
}

export function Footer({ left }: { left: boolean }) {
  return left ? Left() : Right();
}
`,
    count: 2,
  },
] as const;

describe("fixed native Array.from ordinal keys", () => {
  it.each(renderers)("$name", ({ source, count }) => {
    const result = runRule(noArrayIndexAsKey, source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(count);
  });

  it("retains the warning when React memo resolves to a local shim", () => {
    const directory = mkdtempSync(join(tmpdir(), "array-from-ordinal-react-shim-"));
    try {
      writeFileSync(
        join(directory, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: { paths: { react: ["./react-shim.ts"] } },
        }),
      );
      writeFileSync(
        join(directory, "react-shim.ts"),
        "export const memo = (renderer: unknown) => renderer;",
      );
      const result = runRule(noArrayIndexAsKey, renderers[0].source, {
        filename: join(directory, "footer.tsx"),
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
