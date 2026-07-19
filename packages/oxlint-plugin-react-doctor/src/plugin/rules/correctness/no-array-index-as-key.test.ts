import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noArrayIndexAsKey } from "./no-array-index-as-key.js";

describe("no-array-index-as-key (test-harness smoke test)", () => {
  it("flags index used as JSX key", () => {
    const code = `const App = ({ items }) => items.map((item, index) => <li key={index}>{item}</li>);
`;
    const result = runRule(noArrayIndexAsKey, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("index");
  });

  it("does not flag stable id used as JSX key", () => {
    const code = `const App = ({ items }) => items.map((item) => <li key={item.id}>{item.name}</li>);
`;
    const result = runRule(noArrayIndexAsKey, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag index inside Array.from(...).map(...)", () => {
    const code = `const App = () => Array.from({ length: 5 }).map((_, index) => <li key={index} />);
`;
    const result = runRule(noArrayIndexAsKey, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag index when the receiver is a variable holding a static placeholder", () => {
    const code = `const App = () => {
  const list = Array.from({ length: 3 });
  return list.map((_, index) => <li key={\`mobile-\${index}\`} />);
};
`;
    const result = runRule(noArrayIndexAsKey, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags index when the receiver variable holds dynamic data", () => {
    const code = `const App = ({ items }) => {
  const list = items.slice(0, 3);
  return list.map((item, index) => <li key={index}>{item.name}</li>);
};
`;
    const result = runRule(noArrayIndexAsKey, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags String(index) coercion used as JSX key", () => {
    const code = `const App = ({ items }) => items.map((item, index) => <li key={String(index)}>{item}</li>);
`;
    const result = runRule(noArrayIndexAsKey, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  describe("string-derived arrays — character position is the identity", () => {
    it("does not flag index keys on characters spread from an interface-typed string prop (ink TUI regression)", () => {
      const code = `
import { Text } from "ink";
interface MatchedNameProps {
  readonly name: string;
  readonly matchedIndices: ReadonlyArray<number>;
  readonly isSelected: boolean;
}
const MatchedName = ({ name, matchedIndices, isSelected }: MatchedNameProps) => {
  const matched = new Set(matchedIndices);
  return (
    <Text bold={isSelected} wrap="truncate-end">
      {[...name].map((char, index) =>
        matched.has(index) ? (
          <Text key={index} color="yellow">
            {char}
          </Text>
        ) : (
          char
        ),
      )}
    </Text>
  );
};
`;
      const result = runRule(noArrayIndexAsKey, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("does not flag index keys on a spread of an inline-annotated string parameter", () => {
      const code = `const Word = ({ text }: { text: string }) => (
  <span>{[...text].map((letter, index) => <b key={index}>{letter}</b>)}</span>
);
`;
      const result = runRule(noArrayIndexAsKey, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("does not flag index keys on a spread of a string literal binding", () => {
      const code = `const Banner = () => {
  const title = "react doctor";
  return <div>{[...title].map((char, index) => <span key={index}>{char}</span>)}</div>;
};
`;
      const result = runRule(noArrayIndexAsKey, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("flags index keys on .split() fragments (bulwarkmail/tracecat FN sweep)", () => {
      const code = `const Paragraphs = ({ body }) => (
  <div>{body.split("\\n").map((line, index) => <p key={index}>{line}</p>)}</div>
);
`;
      const result = runRule(noArrayIndexAsKey, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("does not flag index keys on Array.from of a template literal", () => {
      const code = `const Marquee = ({ suffix }) => (
  <div>{Array.from(\`react \${suffix}\`).map((char, index) => <i key={index}>{char}</i>)}</div>
);
`;
      const result = runRule(noArrayIndexAsKey, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("flags index keys when the mapped binding is initialized from a split (fn-hunt sweep)", () => {
      const code = `const Lines = ({ line }) => {
  const parts = line.split(" ");
  return <div>{parts.map((part, index) => <b key={index}>{part}</b>)}</div>;
};
`;
      const result = runRule(noArrayIndexAsKey, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("still flags when the mapped binding is initialized from a call that is not string-derived", () => {
      const code = `const List = ({ getLetters }) => {
  const letters = getLetters();
  return <ul>{letters.map((letter, index) => <li key={index}>{letter}</li>)}</ul>;
};
`;
      const result = runRule(noArrayIndexAsKey, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("still flags a spread of an untyped identifier (could be a data array)", () => {
      const code = `const List = ({ items }) => (
  <ul>{[...items].map((item, index) => <li key={index}>{item}</li>)}</ul>
);
`;
      const result = runRule(noArrayIndexAsKey, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("still flags a spread of an array-typed prop", () => {
      const code = `const List = ({ items }: { items: string[] }) => (
  <ul>{[...items].map((item, index) => <li key={index}>{item}</li>)}</ul>
);
`;
      const result = runRule(noArrayIndexAsKey, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("still flags when the split output is filtered before mapping", () => {
      const code = `const Lines = ({ body }) => (
  <div>{body.split("\\n").filter(Boolean).map((line, index) => <p key={index}>{line}</p>)}</div>
);
`;
      const result = runRule(noArrayIndexAsKey, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("flags a composite key mixing the index with a same-map item field (fn-hunt sweep)", () => {
      const code = `const Console = ({ messages }) => (
  <div>{messages.map(({ message, time }, index) => <Entry key={\`\${message} \${index}\`} time={time} />)}</div>
);
`;
      const result = runRule(noArrayIndexAsKey, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("flags a composite key mixing the index with a method call on the same-map item (fn-hunt sweep)", () => {
      const code = `const Presets = ({ colors }) => (
  <div>{colors.map((presetColor, index) => <Swatch key={\`preset-\${index}-\${presetColor.toHexString()}\`} />)}</div>
);
`;
      const result = runRule(noArrayIndexAsKey, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("does not flag Array.from({length: values.length}) placeholder index keys", () => {
      const code = `const Thumbs = ({ values }) => (
  <div>{Array.from({ length: values.length }, (_, index) => <Thumb key={index} />)}</div>
);
`;
      const result = runRule(noArrayIndexAsKey, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("does not flag a numeric for-loop counter used as key", () => {
      const code = `const Grid = ({ count }) => {
  const cols = [];
  for (let i = 0; i < count; i++) {
    cols.push(<Col key={i} span={24 / count} />);
  }
  return <Row>{cols}</Row>;
};
`;
      const result = runRule(noArrayIndexAsKey, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("still flags a for-loop counter bounded by real list data's .length", () => {
      const code = `const List = ({ items }) => {
  const out = [];
  for (let i = 0; i < items.length; i++) {
    out.push(<Row key={i} item={items[i]} />);
  }
  return out;
};
`;
      const result = runRule(noArrayIndexAsKey, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("still flags when a placeholder-initialized binding is reassigned to real data", () => {
      const code = `const List = ({ items }) => {
  let list = Array.from({ length: 3 });
  list = items;
  return <ul>{list.map((item, index) => <Row key={\`s-\${index}\`} item={item} />)}</ul>;
};
`;
      const result = runRule(noArrayIndexAsKey, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("still flags a manually incremented index inside a for-of over items", () => {
      const code = `const List = ({ items }) => {
  const out = [];
  let index = 0;
  for (const item of items) {
    out.push(<Row key={index} item={item} />);
    index++;
  }
  return out;
};
`;
      const result = runRule(noArrayIndexAsKey, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("still flags a composite key whose other expression is not item-derived", () => {
      const code = `const List = ({ items, prefix }) => (
  <div>{items.map((item, index) => <Row key={\`\${prefix}-\${index}\`} />)}</div>
);
`;
      const result = runRule(noArrayIndexAsKey, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("still flags a spread of an untyped inner binding shadowing a typed string prop", () => {
      const code = `const Rows = ({ name, groups }: { name: string; groups: string[][] }) => {
  return groups.map((name) => (
    <ul key={name.join("-")}>
      {[...name].map((item, index) => <li key={index}>{item}</li>)}
    </ul>
  ));
};
`;
      const result = runRule(noArrayIndexAsKey, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });
  });
});
