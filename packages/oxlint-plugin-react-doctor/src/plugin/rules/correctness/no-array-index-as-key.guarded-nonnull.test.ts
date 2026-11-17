import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noArrayIndexAsKey } from "./no-array-index-as-key.js";

interface GuardedKeyCase {
  name: string;
  source: string;
  expectedWarnings: number;
  expectedLines?: number[];
  filename?: string;
  forceJsx?: boolean;
}

const cases: GuardedKeyCase[] = [
  {
    name: "01-const-capture-positive-and-fallback",
    source: `interface RecordItem { id: string | null | undefined; alternateId?: string; }
interface ViewProps { records: RecordItem[]; }
const View = ({ records }: ViewProps) => records.map((record, index) => {
  const captured = record.id;
  const chosen = captured ?? index;
  if (captured != null) {
    return <Stateful key={chosen} record={record} probe="safe" />;
  }
  return <Stateful key={chosen} record={record} probe="fallback" />;
});
`,
    expectedWarnings: 1,
    expectedLines: [9],
  },
  {
    name: "02-undefined-only-null-retained",
    source: `interface RecordItem { id: string | null | undefined; alternateId?: string; }
interface ViewProps { records: RecordItem[]; }
const View = ({ records }: ViewProps) => records.map((record, index) => {
  const captured = record.id;
  const chosen = captured ?? index;
  if (captured !== undefined) {
    return <Stateful key={chosen} record={record} probe="null-still-possible" />;
  }
  return <Stateful key={chosen} record={record} probe="fallback" />;
});
`,
    expectedWarnings: 2,
    expectedLines: [7, 9],
  },
  {
    name: "03-reassigned-capture-retained",
    source: `interface RecordItem { id: string | null | undefined; alternateId?: string; }
interface ViewProps { records: RecordItem[]; }
const View = ({ records }: ViewProps) => records.map((record, index) => {
  let captured = record.id;
  const chosen = captured ?? index;
  captured = record.alternateId;
  if (captured != null) {
    return <Stateful key={chosen} record={record} />;
  }
  return null;
});
`,
    expectedWarnings: 1,
    expectedLines: [8],
  },
  {
    name: "04-shadowed-guard-symbol-retained",
    source: `interface RecordItem { id: string | null | undefined; alternateId?: string; }
interface ViewProps { records: RecordItem[]; }
const View = ({ records }: ViewProps) => records.map((record, index) => {
  const captured = record.id;
  const chosen = captured ?? index;
  {
    const captured = record.alternateId;
    if (captured != null) {
      return <Stateful key={chosen} record={record} />;
    }
  }
  return null;
});
`,
    expectedWarnings: 1,
    expectedLines: [9],
  },
  {
    name: "05-opaque-guard-alias-retained",
    source: `interface RecordItem { id: string | null | undefined; alternateId?: string; }
interface ViewProps { records: RecordItem[]; }
declare const verifyValue: (value: string | null | undefined) => boolean;
const View = ({ records }: ViewProps) => records.map((record, index) => {
  const captured = record.id;
  const chosen = captured ?? index;
  const present = verifyValue(captured);
  if (present) {
    return <Stateful key={chosen} record={record} />;
  }
  return null;
});
`,
    expectedWarnings: 1,
    expectedLines: [9],
  },
  {
    name: "06-getter-and-captured-index-retained",
    source: `interface RecordItem { id: string | null | undefined; alternateId?: string; }
interface ViewProps { records: RecordItem[]; }
const View = ({ records }: ViewProps) => {
  const getterRows = records.map((record, index) => {
    const chosen = record.id ?? index;
    if (record.id != null) {
      return <Stateful key={chosen} record={record} />;
    }
    return null;
  });
  const positionalRows = records.map((record, index) => {
    const captured = index;
    const chosen = captured ?? index;
    if (captured != null) {
      return <Stateful key={chosen} record={record} />;
    }
    return null;
  });
  return <>{getterRows}{positionalRows}</>;
};
`,
    expectedWarnings: 2,
    expectedLines: [7, 15],
  },
  {
    name: "transparent TypeScript wrappers",
    source: `interface RecordItem { id: string | number | null | undefined; alternateId?: string; }
interface ViewProps { records: RecordItem[]; }
const View = ({ records }: ViewProps) => records.map((record, index) => {
  const captured = record.id;
  const chosen = ((captured as string | null) ?? (index as number));
  if ((captured as string | null) != null) return <Stateful key={(chosen as string | number)} record={record} />;
  return null;
});
`,
    expectedWarnings: 0,
  },
  {
    name: "reversed literal null comparison",
    source: `interface RecordItem { id: string | number | null | undefined; alternateId?: string; }
interface ViewProps { records: RecordItem[]; }
const View = ({ records }: ViewProps) => records.map((record, index) => {
  const captured = record.id;
  const chosen = captured ?? index;
  if (null != captured) return <Stateful key={chosen} record={record} />;
  return null;
});
`,
    expectedWarnings: 0,
  },
  {
    name: "nested lexical blocks in the same callback",
    source: `interface RecordItem { id: string | number | null | undefined; alternateId?: string; }
interface ViewProps { records: RecordItem[]; }
const View = ({ records }: ViewProps) => records.map((record, index) => {
  const captured = record.id;
  {
    const chosen = captured ?? index;
    if (captured != null) return <Stateful key={chosen} record={record} />;
  }
  return null;
});
`,
    expectedWarnings: 0,
  },
  {
    name: "ordered const declarators",
    source: `interface RecordItem { id: string | number | null | undefined; alternateId?: string; }
interface ViewProps { records: RecordItem[]; }
const View = ({ records }: ViewProps) => records.map((record, index) => {
  const captured = record.id, chosen = captured ?? index;
  if (captured != null) return <Stateful key={chosen} record={record} />;
  return null;
});
`,
    expectedWarnings: 0,
  },
  {
    name: "a captured property value after the property changes",
    source: `interface RecordItem { id: string | number | null | undefined; alternateId?: string; }
interface ViewProps { records: RecordItem[]; }
const View = ({ records }: ViewProps) => records.map((record, index) => {
  const captured = record.id;
  const chosen = captured ?? index;
  record.id = null;
  if (captured != null) return <Stateful key={chosen} record={record} />;
  return null;
});
`,
    expectedWarnings: 0,
  },
  {
    name: "a null-only strict guard",
    source: `interface RecordItem { id: string | number | null | undefined; alternateId?: string; }
interface ViewProps { records: RecordItem[]; }
const View = ({ records }: ViewProps) => records.map((record, index) => {
  const captured = record.id;
  const chosen = captured ?? index;
  if (captured !== null) return <Stateful key={chosen} record={record} />;
  return null;
});
`,
    expectedWarnings: 1,
  },
  {
    name: "truthiness without the admitted null guard",
    source: `interface RecordItem { id: string | number | null | undefined; alternateId?: string; }
interface ViewProps { records: RecordItem[]; }
const View = ({ records }: ViewProps) => records.map((record, index) => {
  const captured = record.id;
  const chosen = captured ?? index;
  if (captured) return <Stateful key={chosen} record={record} />;
  return null;
});
`,
    expectedWarnings: 1,
  },
  {
    name: "a conjunction instead of a direct guard",
    source: `interface RecordItem { id: string | number | null | undefined; alternateId?: string; }
interface ViewProps { records: RecordItem[]; }
const View = ({ records }: ViewProps) => records.map((record, index) => {
  const captured = record.id;
  const chosen = captured ?? index;
  if (captured != null && enabled) return <Stateful key={chosen} record={record} />;
  return null;
});
`,
    expectedWarnings: 1,
  },
  {
    name: "a conditional expression",
    source: `interface RecordItem { id: string | number | null | undefined; alternateId?: string; }
interface ViewProps { records: RecordItem[]; }
const View = ({ records }: ViewProps) => records.map((record, index) => {
  const captured = record.id;
  const chosen = captured ?? index;
  return captured != null ? <Stateful key={chosen} record={record} /> : null;
});
`,
    expectedWarnings: 1,
  },
  {
    name: "a logical expression",
    source: `interface RecordItem { id: string | number | null | undefined; alternateId?: string; }
interface ViewProps { records: RecordItem[]; }
const View = ({ records }: ViewProps) => records.map((record, index) => {
  const captured = record.id;
  const chosen = captured ?? index;
  return captured != null && <Stateful key={chosen} record={record} />;
});
`,
    expectedWarnings: 1,
  },
  {
    name: "a while condition",
    source: `interface RecordItem { id: string | number | null | undefined; alternateId?: string; }
interface ViewProps { records: RecordItem[]; }
const View = ({ records }: ViewProps) => records.map((record, index) => {
  const captured = record.id;
  const chosen = captured ?? index;
  while (captured != null) return <Stateful key={chosen} record={record} />;
  return null;
});
`,
    expectedWarnings: 1,
  },
  {
    name: "an early exit",
    source: `interface RecordItem { id: string | number | null | undefined; alternateId?: string; }
interface ViewProps { records: RecordItem[]; }
const View = ({ records }: ViewProps) => records.map((record, index) => {
  const captured = record.id;
  const chosen = captured ?? index;
  if (captured == null) return null;
  return <Stateful key={chosen} record={record} />;
});
`,
    expectedWarnings: 1,
  },
  {
    name: "a negated early exit",
    source: `interface RecordItem { id: string | number | null | undefined; alternateId?: string; }
interface ViewProps { records: RecordItem[]; }
const View = ({ records }: ViewProps) => records.map((record, index) => {
  const captured = record.id;
  const chosen = captured ?? index;
  if (!(captured != null)) return null;
  return <Stateful key={chosen} record={record} />;
});
`,
    expectedWarnings: 1,
  },
  {
    name: "the alternate branch",
    source: `interface RecordItem { id: string | number | null | undefined; alternateId?: string; }
interface ViewProps { records: RecordItem[]; }
const View = ({ records }: ViewProps) => records.map((record, index) => {
  const captured = record.id;
  const chosen = captured ?? index;
  if (captured != null) return null;
  else return <Stateful key={chosen} record={record} />;
});
`,
    expectedWarnings: 1,
  },
  {
    name: "a nested function under the guard",
    source: `interface RecordItem { id: string | number | null | undefined; alternateId?: string; }
interface ViewProps { records: RecordItem[]; }
const View = ({ records }: ViewProps) => records.map((record, index) => {
  const captured = record.id;
  const chosen = captured ?? index;
  if (captured != null) {
    const renderField = () => <Stateful key={chosen} record={record} />;
    return renderField();
  }
  return null;
});
`,
    expectedWarnings: 1,
  },
  {
    name: "a default-backed capture",
    source: `interface RecordItem { id: string | number | null | undefined; alternateId?: string; }
interface ViewProps { records: RecordItem[]; }
const View = ({ records }: ViewProps) => records.map((record, index) => {
  const { captured = record.id } = record;
  const chosen = captured ?? index;
  if (captured != null) return <Stateful key={chosen} record={record} />;
  return null;
});
`,
    expectedWarnings: 1,
  },
  {
    name: "a default-backed key with a reachable inline fallback",
    source: `interface RecordItem { id: string | number | null | undefined; alternateId?: string; }
interface ViewProps { records: RecordItem[]; }
const View = ({ records }: ViewProps) => records.map((record, index) => {
  const captured = record.id;
  const { chosen = captured ?? index } = record;
  if (captured != null) return <Stateful key={chosen ?? index} record={record} />;
  return null;
});
`,
    expectedWarnings: 1,
  },
  {
    name: "a default index parameter",
    source: `interface RecordItem { id: string | number | null | undefined; alternateId?: string; }
interface ViewProps { records: RecordItem[]; }
const View = ({ records }: ViewProps) => records.map((record, index = 0) => {
  const captured = record.id;
  const chosen = captured ?? index;
  if (captured != null) return <Stateful key={chosen} record={record} />;
  return null;
});
`,
    expectedWarnings: 1,
  },
  {
    name: "a mutable chosen key",
    source: `interface RecordItem { id: string | number | null | undefined; alternateId?: string; }
interface ViewProps { records: RecordItem[]; }
const View = ({ records }: ViewProps) => records.map((record, index) => {
  const captured = record.id;
  let chosen = captured ?? index;
  if (captured != null) return <Stateful key={chosen} record={record} />;
  return null;
});
`,
    expectedWarnings: 1,
  },
  {
    name: "a written index parameter",
    source: `interface RecordItem { id: string | number | null | undefined; alternateId?: string; }
interface ViewProps { records: RecordItem[]; }
const View = ({ records }: ViewProps) => records.map((record, index) => {
  const captured = record.id;
  const chosen = captured ?? index;
  index++;
  if (captured != null) return <Stateful key={chosen} record={record} />;
  return null;
});
`,
    expectedWarnings: 1,
  },
  {
    name: "an indirect chosen alias",
    source: `interface RecordItem { id: string | number | null | undefined; alternateId?: string; }
interface ViewProps { records: RecordItem[]; }
const View = ({ records }: ViewProps) => records.map((record, index) => {
  const captured = record.id;
  const chosen = captured ?? index;
  const alias = chosen;
  if (captured != null) return <Stateful key={alias} record={record} />;
  return null;
});
`,
    expectedWarnings: 1,
  },
  {
    name: "an indirect guard alias",
    source: `interface RecordItem { id: string | number | null | undefined; alternateId?: string; }
interface ViewProps { records: RecordItem[]; }
const View = ({ records }: ViewProps) => records.map((record, index) => {
  const captured = record.id;
  const chosen = captured ?? index;
  const present = captured != null;
  if (present) return <Stateful key={chosen} record={record} />;
  return null;
});
`,
    expectedWarnings: 1,
  },
  {
    name: "a fallback index alias",
    source: `interface RecordItem { id: string | number | null | undefined; alternateId?: string; }
interface ViewProps { records: RecordItem[]; }
const View = ({ records }: ViewProps) => records.map((record, index) => {
  const captured = record.id;
  const offset = index;
  const chosen = captured ?? offset;
  if (captured != null) return <Stateful key={chosen} record={record} />;
  return null;
});
`,
    expectedWarnings: 1,
  },
  {
    name: "a captured arithmetic index",
    source: `interface RecordItem { id: string | number | null | undefined; alternateId?: string; }
interface ViewProps { records: RecordItem[]; }
const View = ({ records }: ViewProps) => records.map((record, index) => {
  const captured = index + 1;
  const chosen = captured ?? index;
  if (captured != null) return <Stateful key={chosen} record={record} />;
  return null;
});
`,
    expectedWarnings: 1,
  },
  {
    name: "a different map index",
    source: `interface RecordItem { id: string | number | null | undefined; alternateId?: string; }
interface ViewProps { records: RecordItem[]; }
const View = ({ records }: ViewProps) => records.map((record, index) =>
  records.map((child, childIndex) => {
    const captured = child.id;
    const chosen = captured ?? index;
    if (captured != null) return <Stateful key={chosen} record={child} />;
    return null;
  })
);
`,
    expectedWarnings: 1,
  },
  {
    name: "flatMap outside the admitted map shape",
    source: `interface RecordItem { id: string | number | null | undefined; alternateId?: string; }
interface ViewProps { records: RecordItem[]; }
const View = ({ records }: ViewProps) => records.flatMap((record, index) => {
  const captured = record.id;
  const chosen = captured ?? index;
  if (captured != null) return <Stateful key={chosen} record={record} />;
  return null;
});
`,
    expectedWarnings: 1,
  },
  {
    name: "a non-JSX cloneElement key",
    source: `interface RecordItem { id: string | number | null | undefined; alternateId?: string; }
interface ViewProps { records: RecordItem[]; }
import { cloneElement } from "react";
const View = ({ records }: ViewProps) => records.map((record, index) => {
  const captured = record.id;
  const chosen = captured ?? index;
  if (captured != null) return cloneElement(element, { key: chosen });
  return null;
});
`,
    expectedWarnings: 1,
  },
  {
    name: "a chosen value initialized after its key use",
    source: `interface RecordItem { id: string | number | null | undefined; alternateId?: string; }
interface ViewProps { records: RecordItem[]; }
const View = ({ records }: ViewProps) => records.map((record, index) => {
  const captured = record.id;
  if (captured != null) return <Stateful key={chosen} record={record} />;
  const chosen = captured ?? index;
  return null;
});
`,
    expectedWarnings: 1,
  },

  {
    name: "a capture initialized after the key alias",
    source: `const View = ({ records }) => records.map((record, index) => {
  const chosen = captured ?? index;
  const captured = record.id;
  if (captured != null) return <Stateful key={chosen} record={record} />;
  return null;
});`,
    expectedWarnings: 1,
  },
  {
    name: "a captured callback parameter",
    source: `const View = ({ records }) => records.map((record, index, captured = record.id) => {
  const chosen = captured ?? index;
  if (captured != null) return <Stateful key={chosen} record={record} />;
  return null;
});`,
    expectedWarnings: 1,
  },

  {
    name: "dynamic with bindings shadowing immutable captures",
    source: `const View = ({ records }) => records.map((record, index) => {
  const captured = record.id;
  const chosen = captured ?? index;
  with ({ chosen: index, captured: "present" }) {
    if (captured != null) return <Stateful key={chosen} record={record} />;
  }
  return null;
});`,
    filename: "fixture.cjs",
    forceJsx: true,
    expectedWarnings: 1,
  },
  {
    name: "a typed this parameter before the actual runtime index",
    source: `const View = ({ records }) => records.map(function (this: void, record, index) {
  const captured = record.id;
  const chosen = captured ?? index;
  if (captured != null) return <Stateful key={chosen} record={record} />;
  return null;
});`,
    expectedWarnings: 1,
  },
  {
    name: "a typed this parameter before an item named index",
    source: `const View = ({ records }) => records.map(function (this: void, index, position) {
  const captured = index.id;
  const chosen = captured ?? index;
  if (captured != null) return <Stateful key={chosen} record={index} />;
  return null;
});`,
    expectedWarnings: 1,
  },
  {
    name: "a typed this callback whose captured key remains the runtime index",
    source: `const View = ({ records }) => records.map(function (this: void, record, index) {
  const captured = index;
  const chosen = captured ?? index;
  if (captured != null) return <Stateful key={chosen} record={record} />;
  return null;
});`,
    expectedWarnings: 1,
  },
];

describe("no-array-index-as-key guarded nullish fallbacks", () => {
  it.each(cases)(
    "preserves the contract for $name",
    ({ source, expectedWarnings, expectedLines, filename, forceJsx }) => {
      const result = runRule(noArrayIndexAsKey, source, {
        includeLocations: true,
        ...(filename ? { filename } : {}),
        ...(forceJsx ? { forceJsx } : {}),
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(expectedWarnings);
      if (expectedLines) {
        expect(result.diagnostics.map((diagnostic) => diagnostic.line)).toEqual(expectedLines);
      }
    },
  );
});
