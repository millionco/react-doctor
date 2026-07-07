import type { FnMiningCase } from "../fn-mining-case.js";

// Doc pattern: `array.map((x, i) => <li key={i}>)` — index used as key.
// Variants probe how far the positional-index resolution reaches beyond
// the bare `key={i}` shape.
export const noArrayIndexAsKeyCases: FnMiningCase[] = [
  {
    ruleId: "no-array-index-as-key",
    description: "index offset by arithmetic: key={index + 1}",
    filePath: "src/list.tsx",
    code: `
      const List = ({ items }: { items: Item[] }) => (
        <ul>{items.map((item, index) => <Row key={index + 1} data={item} />)}</ul>
      );
    `,
    shouldFire: true,
  },
  {
    ruleId: "no-array-index-as-key",
    description: "index inside a template literal: key={`item-${index}`}",
    filePath: "src/list.tsx",
    code: `
      const List = ({ items }: { items: Item[] }) => (
        <ul>{items.map((item, index) => <Row key={\`item-\${index}\`} data={item} />)}</ul>
      );
    `,
    shouldFire: true,
  },
  {
    ruleId: "no-array-index-as-key",
    description: "forEach + push building the rows imperatively",
    filePath: "src/list.tsx",
    code: `
      const List = ({ items }: { items: Item[] }) => {
        const rows: JSX.Element[] = [];
        items.forEach((item, i) => {
          rows.push(<Row key={i} data={item} />);
        });
        return <ul>{rows}</ul>;
      };
    `,
    shouldFire: true,
  },
  {
    ruleId: "no-array-index-as-key",
    description: "index laundered through a local variable: const rowKey = index",
    filePath: "src/list.tsx",
    code: `
      const List = ({ items }: { items: Item[] }) => (
        <ul>
          {items.map((item, index) => {
            const rowKey = index;
            return <Row key={rowKey} data={item} />;
          })}
        </ul>
      );
    `,
    shouldFire: true,
  },
  {
    ruleId: "no-array-index-as-key",
    description: "index negated by a unary expression: key={-index}",
    filePath: "src/list.tsx",
    code: `
      const List = ({ items }: { items: Item[] }) => (
        <ul>{items.map((item, index) => <Row key={-index} data={item} />)}</ul>
      );
    `,
    shouldFire: true,
  },
  {
    ruleId: "no-array-index-as-key",
    description: "array entries() tuple destructure: [...items.entries()].map(([i, item]) => ...)",
    filePath: "src/list.tsx",
    code: `
      const List = ({ items }: { items: Item[] }) => (
        <ul>{[...items.entries()].map(([i, item]) => <Row key={i} data={item} />)}</ul>
      );
    `,
    shouldFire: true,
  },
];
