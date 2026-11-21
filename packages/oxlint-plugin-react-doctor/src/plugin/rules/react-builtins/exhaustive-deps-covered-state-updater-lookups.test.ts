import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { exhaustiveDeps } from "./exhaustive-deps.js";

const cases = [
  {
    name: "closed state updater lookup",
    code: 'import { useEffect, useState } from "react";\n\ntype Row = { enabled: boolean };\ntype Catalog = Map<string, Row> | Record<string, Row>;\n\nexport function Selection({ catalog, spare, color }: { catalog: Catalog; spare: Catalog; color: string }) {\n  const [hidden, setHidden] = useState(() => new Set<string>());\n  const lookup = (id: string) => catalog instanceof Map ? catalog.get(id) : catalog?.[id];\n  useEffect(() => {\n    setHidden((current) => {\n      let changed = false;\n      const next = new Set<string>();\n      current.forEach((id) => {\n        const row = lookup(id);\n        if (row?.enabled === false) next.add(id);\n        else changed = true;\n      });\n      return changed ? next : current;\n    });\n  }, [catalog]);\n  return <div>{["entry"].map((id) => <span key={id}>{String(lookup(id)?.enabled)} {hidden.size}</span>)}</div>;\n}\n',
    curated: 0,
    upstream: 1,
  },
  {
    name: "duplicated state write",
    code: 'import { useEffect, useState } from "react";\n\ntype Row = { enabled: boolean };\ntype Catalog = Map<string, Row> | Record<string, Row>;\n\nexport function Selection({ catalog, spare, color }: { catalog: Catalog; spare: Catalog; color: string }) {\n  const [hidden, setHidden] = useState(() => new Set<string>());\n  const lookup = (id: string) => catalog instanceof Map ? catalog.get(id) : catalog?.[id];\n  useEffect(() => {\n    setHidden((current) => {\n      let changed = false;\n      const next = new Set<string>();\n      current.forEach((id) => {\n        const row = lookup(id);\n        if (row?.enabled === false) next.add(id);\n        else changed = true;\n      });\n      return changed ? next : current;\n    });\n    setHidden(() => new Set<string>());\n  }, [catalog]);\n  return <div>{["entry"].map((id) => <span key={id}>{String(lookup(id)?.enabled)} {hidden.size}</span>)}</div>;\n}\n',
    curated: 1,
    upstream: 1,
  },
  {
    name: "escaped lookup identity",
    code: 'import { useEffect, useState } from "react";\n\ntype Row = { enabled: boolean };\ntype Catalog = Map<string, Row> | Record<string, Row>;\n\nexport function Selection({ catalog, spare, color }: { catalog: Catalog; spare: Catalog; color: string }) {\n  const [hidden, setHidden] = useState(() => new Set<string>());\n  const lookup = (id: string) => catalog instanceof Map ? catalog.get(id) : catalog?.[id];\n  useEffect(() => {\n    setHidden((current) => {\n      let changed = false;\n      const next = new Set<string>();\n      current.forEach((id) => {\n        const row = lookup(id);\n        if (row?.enabled === false) next.add(id);\n        else changed = true;\n      });\n      return changed ? next : current;\n    });\n  }, [catalog]);\n  return <div onClick={lookup as never}>{["entry"].map((id) => <span key={id}>{String(lookup(id)?.enabled)} {hidden.size}</span>)}</div>;\n}\n',
    curated: 1,
    upstream: 1,
  },
  {
    name: "explicit helper dependency",
    code: 'import { useEffect, useState } from "react";\n\ntype Row = { enabled: boolean };\ntype Catalog = Map<string, Row> | Record<string, Row>;\n\nexport function Selection({ catalog, spare, color }: { catalog: Catalog; spare: Catalog; color: string }) {\n  const [hidden, setHidden] = useState(() => new Set<string>());\n  const lookup = (id: string) => catalog instanceof Map ? catalog.get(id) : catalog?.[id];\n  useEffect(() => {\n    setHidden((current) => {\n      let changed = false;\n      const next = new Set<string>();\n      current.forEach((id) => {\n        const row = lookup(id);\n        if (row?.enabled === false) next.add(id);\n        else changed = true;\n      });\n      return changed ? next : current;\n    });\n  }, [catalog, lookup]);\n  return <div>{["entry"].map((id) => <span key={id}>{String(lookup(id)?.enabled)} {hidden.size}</span>)}</div>;\n}\n',
    curated: 1,
    upstream: 1,
  },
  {
    name: "extra render capture",
    code: 'import { useEffect, useState } from "react";\n\ntype Row = { enabled: boolean };\ntype Catalog = Map<string, Row> | Record<string, Row>;\n\nexport function Selection({ catalog, spare, color }: { catalog: Catalog; spare: Catalog; color: string }) {\n  const [hidden, setHidden] = useState(() => new Set<string>());\n  const lookup = (id: string) => catalog instanceof Map ? catalog.get(color + id) : catalog?.[color + id];\n  useEffect(() => {\n    setHidden((current) => {\n      let changed = false;\n      const next = new Set<string>();\n      current.forEach((id) => {\n        const row = lookup(id);\n        if (row?.enabled === false) next.add(id);\n        else changed = true;\n      });\n      return changed ? next : current;\n    });\n  }, [catalog]);\n  return <div>{["entry"].map((id) => <span key={id}>{String(lookup(id)?.enabled)} {hidden.size}</span>)}</div>;\n}\n',
    curated: 1,
    upstream: 1,
  },
  {
    name: "late lookup initialization",
    code: 'import { useEffect, useState } from "react";\n\ntype Row = { enabled: boolean };\ntype Catalog = Map<string, Row> | Record<string, Row>;\n\nexport function Selection({ catalog, spare, color }: { catalog: Catalog; spare: Catalog; color: string }) {\n  const [hidden, setHidden] = useState(() => new Set<string>());\n  useEffect(() => {\n    setHidden((current) => {\n      let changed = false;\n      const next = new Set<string>();\n      current.forEach((id) => {\n        const row = lookup(id);\n        if (row?.enabled === false) next.add(id);\n        else changed = true;\n      });\n      return changed ? next : current;\n    });\n  }, [catalog]);\n  if (color === "hidden") return null;\n  const lookup = (id: string) => catalog instanceof Map ? catalog.get(id) : catalog?.[id];\n  return <div>{["entry"].map((id) => <span key={id}>{String(lookup(id)?.enabled)} {hidden.size}</span>)}</div>;\n}\n',
    curated: 1,
    upstream: 1,
  },
  {
    name: "omitted whole receiver",
    code: 'import { useEffect, useState } from "react";\n\ntype Row = { enabled: boolean };\ntype Catalog = Map<string, Row> | Record<string, Row>;\n\nexport function Selection({ catalog, spare, color }: { catalog: Catalog; spare: Catalog; color: string }) {\n  const [hidden, setHidden] = useState(() => new Set<string>());\n  const lookup = (id: string) => catalog instanceof Map ? catalog.get(id) : catalog?.[id];\n  useEffect(() => {\n    setHidden((current) => {\n      let changed = false;\n      const next = new Set<string>();\n      current.forEach((id) => {\n        const row = lookup(id);\n        if (row?.enabled === false) next.add(id);\n        else changed = true;\n      });\n      return changed ? next : current;\n    });\n  }, []);\n  return <div>{["entry"].map((id) => <span key={id}>{String(lookup(id)?.enabled)} {hidden.size}</span>)}</div>;\n}\n',
    curated: 1,
    upstream: 1,
  },
  {
    name: "opaque state setter",
    code: 'import { useEffect } from "react";\n\ntype Row = { enabled: boolean };\ntype Catalog = Map<string, Row> | Record<string, Row>;\n\ndeclare function useLocalState(init: () => Set<string>): [Set<string>, (callback: (old: Set<string>) => Set<string>) => void];\n\nexport function Selection({ catalog, spare, color }: { catalog: Catalog; spare: Catalog; color: string }) {\n  const [hidden, setHidden] = useLocalState(() => new Set<string>());\n  const lookup = (id: string) => catalog instanceof Map ? catalog.get(id) : catalog?.[id];\n  useEffect(() => {\n    setHidden((current) => {\n      let changed = false;\n      const next = new Set<string>();\n      current.forEach((id) => {\n        const row = lookup(id);\n        if (row?.enabled === false) next.add(id);\n        else changed = true;\n      });\n      return changed ? next : current;\n    });\n  }, [catalog]);\n  return <div>{["entry"].map((id) => <span key={id}>{String(lookup(id)?.enabled)} {hidden.size}</span>)}</div>;\n}\n',
    curated: 1,
    upstream: 1,
  },
  {
    name: "partial receiver path",
    code: 'import { useEffect, useState } from "react";\n\ntype Row = { enabled: boolean };\ntype Catalog = Map<string, Row> | Record<string, Row>;\n\nexport function Selection({ catalog, spare, color }: { catalog: Catalog; spare: Catalog; color: string }) {\n  const [hidden, setHidden] = useState(() => new Set<string>());\n  const lookup = (id: string) => catalog instanceof Map ? catalog.get(id) : catalog?.[id];\n  useEffect(() => {\n    setHidden((current) => {\n      let changed = false;\n      const next = new Set<string>();\n      current.forEach((id) => {\n        const row = lookup(id);\n        if (row?.enabled === false) next.add(id);\n        else changed = true;\n      });\n      return changed ? next : current;\n    });\n  }, [catalog.status]);\n  return <div>{["entry"].map((id) => <span key={id}>{String(lookup(id)?.enabled)} {hidden.size}</span>)}</div>;\n}\n',
    curated: 1,
    upstream: 1,
  },
  {
    name: "shadowed lookup callback",
    code: 'import { useEffect, useState } from "react";\n\ntype Row = { enabled: boolean };\ntype Catalog = Map<string, Row> | Record<string, Row>;\n\nexport function Selection({ catalog, spare, color }: { catalog: Catalog; spare: Catalog; color: string }) {\n  const [hidden, setHidden] = useState(() => new Set<string>());\n  const lookup = (id: string) => catalog instanceof Map ? catalog.get(id) : catalog?.[id];\n  useEffect(() => {\n    setHidden((current) => {\n      let changed = false;\n      const next = new Set<string>();\n      current.forEach((id) => {\n        const lookup = (item: string) => spare instanceof Map ? spare.get(item) : spare[item];\n        const row = lookup(id);\n        if (row?.enabled === false) next.add(id);\n        else changed = true;\n      });\n      return changed ? next : current;\n    });\n  }, [catalog]);\n  return <div>{["entry"].map((id) => <span key={id}>{String(lookup(id)?.enabled)} {hidden.size}</span>)}</div>;\n}\n',
    curated: 1,
    upstream: 1,
  },
  {
    name: "sibling live capture",
    code: 'import { useEffect, useState } from "react";\n\ntype Row = { enabled: boolean };\ntype Catalog = Map<string, Row> | Record<string, Row>;\n\nexport function Selection({ catalog, spare, color }: { catalog: Catalog; spare: Catalog; color: string }) {\n  const [hidden, setHidden] = useState(() => new Set<string>());\n  const lookup = (id: string) => catalog instanceof Map ? catalog.get(id) : catalog?.[id];\n  useEffect(() => {\n    setHidden((current) => {\n      let changed = false;\n      const next = new Set<string>();\n      current.forEach((id) => {\n        const row = lookup(id);\n        if (row?.enabled === false && color === "gray") next.add(id);\n        else changed = true;\n      });\n      return changed ? next : current;\n    });\n  }, [catalog]);\n  return <div>{["entry"].map((id) => <span key={id}>{String(lookup(id)?.enabled)} {hidden.size}</span>)}</div>;\n}\n',
    curated: 1,
    upstream: 1,
  },
] as const;

describe("covered receiver in a closed state updater lookup", () => {
  for (const { name, code, curated, upstream } of cases) {
    it(name, () => {
      const result = runRule(exhaustiveDeps, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(curated);
      if (name === "sibling live capture") {
        expect(result.diagnostics[0].message).toContain("`color`");
        expect(result.diagnostics[0].message).not.toContain("`lookup`");
      }
    });
    it(`${name} preserves upstream behavior`, () => {
      const result = runRule(exhaustiveDeps, code, {
        settings: { "react-doctor": { portedRuleMode: "upstream" } },
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(upstream);
    });
  }
});

const guardCases = [
  {
    name: "covered nested state set iterator",
    code: 'import { useEffect, useState } from "react";\n\ntype Row = { visible: boolean };\ntype Rows = Map<string, Row> | Record<string, Row>;\n\nexport function HiddenRows({ initialRows, replacement, hideFallback }: {\n  initialRows: Rows;\n  replacement: Rows;\n  hideFallback: boolean;\n}) {\n  const rows = initialRows;\n  const [visible, setVisible] = useState(() => new Set(["row-a"]));\n  const getRow = (id: string) => rows instanceof Map ? rows.get(id) : rows[id];\n\n  useEffect(() => {\n    setVisible(previous => {\n      let changed = false;\n      const next = new Set<string>();\n      previous.forEach(id => {\n        if (getRow(id)?.visible) next.add(id);\n        else changed = true;\n      });\n      return changed ? next : previous;\n    });\n  }, [rows]);\n\n  return <ul>{[...visible].map(id => <li key={id}>{getRow(id)?.visible ? "Yes" : "No"}</li>)}</ul>;\n}\n',
    line: 25,
    column: 5,
    curated: 0,
    upstream: 1,
  },
  {
    name: "lexical arguments lookup fallback",
    code: 'import { useEffect, useState } from "react";\n\ntype Row = { visible: boolean };\ntype Rows = Map<string, Row> | Record<string, Row>;\n\nexport function HiddenRows({ initialRows, replacement, hideFallback }: {\n  initialRows: Rows;\n  replacement: Rows;\n  hideFallback: boolean;\n}) {\n  const rows = initialRows;\n  const [visible, setVisible] = useState(() => new Set(["row-a"]));\n  const getRow = (id: string) => {\n    if (arguments[0].hideFallback) return undefined;\n    return rows instanceof Map ? rows.get(id) : rows[id];\n  };\n\n  useEffect(() => {\n    setVisible(previous => {\n      let changed = false;\n      const next = new Set<string>();\n      previous.forEach(id => {\n        if (getRow(id)?.visible) next.add(id);\n        else changed = true;\n      });\n      return changed ? next : previous;\n    });\n  }, [rows]);\n\n  return <ul>{[...visible].map(id => <li key={id}>{getRow(id)?.visible ? "Yes" : "No"}</li>)}</ul>;\n}\n',
    line: 28,
    column: 5,
    curated: 1,
    upstream: 1,
  },
  {
    name: "lookup receiver reassigned in layout",
    code: 'import { useEffect, useLayoutEffect, useState } from "react";\n\ntype Row = { visible: boolean };\ntype Rows = Map<string, Row> | Record<string, Row>;\n\nexport function HiddenRows({ initialRows, replacement, hideFallback }: {\n  initialRows: Rows;\n  replacement: Rows;\n  hideFallback: boolean;\n}) {\n  let rows = initialRows;\n  const [visible, setVisible] = useState(() => new Set(["row-a"]));\n  useLayoutEffect(() => { rows = replacement; }, [replacement]);\n  const getRow = (id: string) => rows instanceof Map ? rows.get(id) : rows[id];\n\n  useEffect(() => {\n    setVisible(previous => {\n      let changed = false;\n      const next = new Set<string>();\n      previous.forEach(id => {\n        if (getRow(id)?.visible) next.add(id);\n        else changed = true;\n      });\n      return changed ? next : previous;\n    });\n  }, [rows]);\n\n  return <ul>{[...visible].map(id => <li key={id}>{getRow(id)?.visible ? "Yes" : "No"}</li>)}</ul>;\n}\n',
    line: 26,
    column: 5,
    curated: 1,
    upstream: 1,
  },
  {
    name: "direct eval rebinding",
    code: 'import { useEffect, useState } from "react";\n\ntype Row = { enabled: boolean };\ntype Catalog = Map<string, Row> | Record<string, Row>;\n\nexport function Selection({ catalog, spare, color }: { catalog: Catalog; spare: Catalog; color: string }) {\n  const [hidden, setHidden] = useState(() => new Set<string>());\n  const lookup = (id: string) => catalog instanceof Map ? catalog.get(id) : catalog?.[id];\n  useEffect(() => {\n    setHidden((current) => {\n      let changed = false;\n      const next = new Set<string>();\n      current.forEach((id) => {\n        const row = lookup(id);\n        if (row?.enabled === false) next.add(id);\n        else changed = true;\n      });\n      return changed ? next : current;\n    });\n  }, [catalog]);\n  eval("catalog = spare");\n  return <div>{["entry"].map((id) => <span key={id}>{String(lookup(id)?.enabled)} {hidden.size}</span>)}</div>;\n}\n',
    line: 20,
    column: 5,
    curated: 1,
    upstream: 1,
  },
  {
    name: "ambient eval provider",
    code: 'import { useEffect, useState } from "react";\n\ntype Row = { enabled: boolean };\ntype Catalog = Map<string, Row> | Record<string, Row>;\n\nexport function Selection({ catalog, spare, color }: { catalog: Catalog; spare: Catalog; color: string }) {\n  const [hidden, setHidden] = useState(() => new Set<string>());\n  const lookup = (id: string) => catalog instanceof Map ? catalog.get(id) : catalog?.[id];\n  useEffect(() => {\n    setHidden((current) => {\n      let changed = false;\n      const next = new Set<string>();\n      current.forEach((id) => {\n        const row = lookup(id);\n        if (row?.enabled === false) next.add(id);\n        else changed = true;\n      });\n      return changed ? next : current;\n    });\n  }, [catalog]);\n  globalThis.eval("console.info(42)");\n  return <div>{["entry"].map((id) => <span key={id}>{String(lookup(id)?.enabled)} {hidden.size}</span>)}</div>;\n}\n',
    line: 20,
    column: 5,
    curated: 1,
    upstream: 1,
  },
  {
    name: "default react provider",
    code: 'import ReactBinding, { useEffect, useState } from "react";\n\nObject.defineProperty(ReactBinding, "useState", {\n  value: () => [new Set<string>(), (_update: unknown) => undefined],\n});\n\ntype Row = { enabled: boolean };\ntype Catalog = Map<string, Row> | Record<string, Row>;\n\nexport function Selection({ catalog, spare, color }: { catalog: Catalog; spare: Catalog; color: string }) {\n  const [hidden, setHidden] = useState(() => new Set<string>());\n  const lookup = (id: string) => catalog instanceof Map ? catalog.get(id) : catalog?.[id];\n  useEffect(() => {\n    setHidden((current) => {\n      let changed = false;\n      const next = new Set<string>();\n      current.forEach((id) => {\n        const row = lookup(id);\n        if (row?.enabled === false) next.add(id);\n        else changed = true;\n      });\n      return changed ? next : current;\n    });\n  }, [catalog]);\n  return <div>{["entry"].map((id) => <span key={id}>{String(lookup(id)?.enabled)} {hidden.size}</span>)}</div>;\n}\n',
    line: 24,
    column: 5,
    curated: 1,
    upstream: 1,
  },
  {
    name: "namespace react provider",
    code: 'import { useEffect, useState } from "react";\nimport * as ReactBinding from "react";\n\nObject.defineProperty(ReactBinding, "useState", {\n  value: () => [new Set<string>(), (_update: unknown) => undefined],\n});\n\ntype Row = { enabled: boolean };\ntype Catalog = Map<string, Row> | Record<string, Row>;\n\nexport function Selection({ catalog, spare, color }: { catalog: Catalog; spare: Catalog; color: string }) {\n  const [hidden, setHidden] = useState(() => new Set<string>());\n  const lookup = (id: string) => catalog instanceof Map ? catalog.get(id) : catalog?.[id];\n  useEffect(() => {\n    setHidden((current) => {\n      let changed = false;\n      const next = new Set<string>();\n      current.forEach((id) => {\n        const row = lookup(id);\n        if (row?.enabled === false) next.add(id);\n        else changed = true;\n      });\n      return changed ? next : current;\n    });\n  }, [catalog]);\n  return <div>{["entry"].map((id) => <span key={id}>{String(lookup(id)?.enabled)} {hidden.size}</span>)}</div>;\n}\n',
    line: 25,
    column: 5,
    curated: 1,
    upstream: 1,
  },
] as const;

describe("closed lookup provider and implicit capture guards", () => {
  for (const { name, code, line, column, curated, upstream } of guardCases) {
    for (const mode of ["curated", "upstream"] as const) {
      it(`${name} in ${mode} mode`, () => {
        const result = runRule(exhaustiveDeps, code, {
          includeLocations: true,
          settings: { "react-doctor": { portedRuleMode: mode } },
        });
        expect(result.parseErrors).toEqual([]);
        const selected = result.diagnostics.filter(
          (diagnostic) => diagnostic.line === line && diagnostic.column === column,
        );
        expect(selected).toHaveLength(mode === "curated" ? curated : upstream);
      });
    }
  }
});
