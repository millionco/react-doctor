import type { FnMiningCase } from "../fn-mining-case.js";

// Doc pattern: an inline function allocated per render and passed as a
// prop to a memoized consumer. The rule is heavily gated (same-file
// memo proof, parameter-binding-wrapper carve-out, one-shot handler
// names), so variants probe each gate. `onHover` is used because it is
// not in the one-shot handler allowlist.
export const jsxNoNewFunctionAsPropCases: FnMiningCase[] = [
  {
    ruleId: "jsx-no-new-function-as-prop",
    description: "memoized same-file consumer + inline arrow with a loop body",
    filePath: "src/rows.tsx",
    code: `
      const Row = memo(({ onHover }: RowProps) => <div onMouseEnter={onHover}>row</div>);
      const List = ({ rows }: { rows: RowData[] }) => (
        <Row
          onHover={() => {
            for (const row of rows) {
              markVisited(row);
            }
          }}
        />
      );
    `,
    shouldFire: true,
  },
  {
    ruleId: "jsx-no-new-function-as-prop",
    description: "memoized consumer + .bind() allocated per render",
    filePath: "src/rows.tsx",
    code: `
      const Row = memo(({ onHover }: RowProps) => <div onMouseEnter={onHover}>row</div>);
      const List = ({ rowId }: { rowId: string }) => (
        <Row onHover={handleHover.bind(null, rowId)} />
      );
    `,
    shouldFire: true,
  },
  {
    ruleId: "jsx-no-new-function-as-prop",
    description:
      "memoized consumer + parameter-binding wrapper () => setCount(count + 1) (deliberate carve-out)",
    filePath: "src/rows.tsx",
    code: `
      const Row = memo(({ onHover }: RowProps) => <div onMouseEnter={onHover}>row</div>);
      const List = () => {
        const [count, setCount] = useState(0);
        return <Row onHover={() => setCount(count + 1)} />;
      };
    `,
    shouldFire: false,
    carveOutReason:
      "Parameter-binding wrappers are exempt by design (`isParameterBindingWrapper`): the arrow's whole body is one stable call whose arguments include arithmetic on captured values — the rule source documents page-step handlers like `() => setPage(page + 1)` as reaching this gate. `useCallback` can't remove the per-render capture without restructuring the data flow.",
  },
  {
    ruleId: "jsx-no-new-function-as-prop",
    description:
      "non-memoized same-file consumer + inline arrow with a loop body (deliberate carve-out)",
    filePath: "src/rows.tsx",
    code: `
      const Row = ({ onHover }: RowProps) => <div onMouseEnter={onHover}>row</div>;
      const List = ({ rows }: { rows: RowData[] }) => (
        <Row
          onHover={() => {
            for (const row of rows) {
              markVisited(row);
            }
          }}
        />
      );
    `,
    shouldFire: false,
    carveOutReason:
      "Consumer-memo gate: the rule only fires when same-file analysis PROVES the consumer is memoised. A non-memoised consumer re-renders on every parent render regardless of function identity, so `useCallback` buys nothing (documented in the rule's JSXAttribute visitor).",
  },
  {
    ruleId: "jsx-no-new-function-as-prop",
    description:
      "imported consumer (unknown memo status) + inline arrow with a loop body (deliberate carve-out)",
    filePath: "src/rows.tsx",
    code: `
      import { Row } from "./row";
      const List = ({ rows }: { rows: RowData[] }) => (
        <Row
          onHover={() => {
            for (const row of rows) {
              markVisited(row);
            }
          }}
        />
      );
    `,
    shouldFire: false,
    carveOutReason:
      'Consumer-memo gate: "unknown" memo status short-circuits like "not-memoised" — a 100-repo audit showed most imported consumers aren\'t memoised, so firing on unknowns was ~95% FP (documented in the rule\'s JSXAttribute visitor).',
  },
  {
    ruleId: "jsx-no-new-function-as-prop",
    description: "memoized consumer + arrow returning another function (HoC-style)",
    filePath: "src/rows.tsx",
    code: `
      const Row = memo(({ onHover }: RowProps) => <div onMouseEnter={onHover}>row</div>);
      const List = () => <Row onHover={() => () => submitSelection()} />;
    `,
    shouldFire: true,
  },
];
