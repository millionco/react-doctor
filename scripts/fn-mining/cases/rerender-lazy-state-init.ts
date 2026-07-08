import type { FnMiningCase } from "../fn-mining-case.js";

// Doc pattern: `useState(expensiveFn())` — the initializer runs on every
// render. Variants probe expression wrappers around the expensive call
// (the rule only inspects a top-level CallExpression argument).
export const rerenderLazyStateInitCases: FnMiningCase[] = [
  {
    ruleId: "rerender-lazy-state-init",
    description: "canonical: useState(parseItems(raw))",
    filePath: "src/table.tsx",
    code: `
      const Table = ({ raw }: { raw: string }) => {
        const [items, setItems] = useState(parseItems(raw));
        return <List items={items} />;
      };
    `,
    shouldFire: true,
  },
  {
    ruleId: "rerender-lazy-state-init",
    description: "member call: useState(JSON.parse(raw))",
    filePath: "src/table.tsx",
    code: `
      const Table = ({ raw }: { raw: string }) => {
        const [items, setItems] = useState(JSON.parse(raw));
        return <List items={items} />;
      };
    `,
    shouldFire: true,
  },
  {
    ruleId: "rerender-lazy-state-init",
    description: "expensive call behind a nullish fallback: useState(buildRows(raw) ?? [])",
    filePath: "src/table.tsx",
    code: `
      const Table = ({ raw }: { raw: string }) => {
        const [rows, setRows] = useState(buildRows(raw) ?? []);
        return <List items={rows} />;
      };
    `,
    shouldFire: true,
  },
  {
    ruleId: "rerender-lazy-state-init",
    description: "expensive call spread into an array literal: useState([...buildRows(raw)])",
    filePath: "src/table.tsx",
    code: `
      const Table = ({ raw }: { raw: string }) => {
        const [rows, setRows] = useState([...buildRows(raw)]);
        return <List items={rows} />;
      };
    `,
    shouldFire: true,
  },
  {
    ruleId: "rerender-lazy-state-init",
    description: "constructor initializer: useState(new HeavyModel(config))",
    filePath: "src/table.tsx",
    code: `
      const Table = ({ config }: { config: Config }) => {
        const [model, setModel] = useState(new HeavyModel(config));
        return <Chart model={model} />;
      };
    `,
    shouldFire: true,
  },
  {
    ruleId: "rerender-lazy-state-init",
    description: "member read off an expensive call: useState(computeLayout(width).sections)",
    filePath: "src/table.tsx",
    code: `
      const Table = ({ width }: { width: number }) => {
        const [sections, setSections] = useState(computeLayout(width).sections);
        return <List items={sections} />;
      };
    `,
    shouldFire: true,
  },
];
