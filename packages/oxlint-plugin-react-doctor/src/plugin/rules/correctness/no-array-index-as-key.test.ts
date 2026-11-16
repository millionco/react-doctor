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
  readonly matchedIndices: ReadonlyArray<number>;
  readonly isSelected: boolean;
}
interface MatchedNameProps {
  readonly name: string;
  readonly accessibilityLabel?: string;
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

describe("cloned element keys", () => {
  it.each([
    `import {cloneElement} from 'react'; const Rows = ({children}) => children.map((child, index) => cloneElement(child, {key: index}));`,
    `import {cloneElement as clone} from 'react'; const Rows = ({children}) => children.map((child, index) => clone(child, {key: String(index)}));`,
    `import React from 'react'; const Rows = ({children}) => children.map((child, index) => React.cloneElement(child, {['key']: index}));`,
    `import {cloneElement} from 'react'; const Rows = ({children}) => children.map((child, index) => cloneElement(child, {...props, key: index}));`,
  ])("reports a positional clone override: %s", (code) => {
    const result = runRule(noArrayIndexAsKey, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    `import {cloneElement} from 'react'; const Rows = ({children}) => children.map((child, index) => cloneElement(child, {key: child.key}));`,
    `import {cloneElement} from 'react'; const Rows = ({children}) => children.map((child, index) => cloneElement(child, {}));`,
    `import {cloneElement} from 'other'; const Rows = ({children}) => children.map((child, index) => cloneElement(child, {key: index}));`,
    `const Rows = ({children, React}) => children.map((child, index) => React.cloneElement(child, {key: index}));`,
    `import {cloneElement} from 'react'; const Rows = ({children}) => children.map((child, index) => cloneElement(child, {key: index, ...props}));`,
    `import {cloneElement} from 'react'; const Rows = () => Array.from({length: 3}).map((child, index) => cloneElement(template, {key: index}));`,
  ])("leaves stable or unproven clone keys alone: %s", (code) => {
    expect(runRule(noArrayIndexAsKey, code).diagnostics).toEqual([]);
  });
});

describe("guarded string-prop text runs", () => {
  it.each([
    {
      name: "single-local-render-helper",
      code: "interface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  const renderText = () => {\n    const { pattern } = props;\n    if (pattern) {\n      return props.text.split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <b key={index}>{segment}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <div>{renderText()}</div>;\n};\n",
    },
    {
      name: "required-regexp-shorthand",
      code: "interface TextProps {\n  text: string;\n  pattern: RegExp;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  const renderText = () => {\n    const { pattern } = props;\n    if (pattern) {\n      return props.text.split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <b key={index}>{segment}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <div>{renderText()}</div>;\n};\n",
    },
    {
      name: "outer-event-does-not-belong-to-text-leaf",
      code: "interface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  const renderText = () => {\n    const { pattern } = props;\n    if (pattern) {\n      return props.text.split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <b key={index}>{segment}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <div onClick={() => choose(props.text)}>{renderText()}</div>;\n};\n",
    },
    {
      name: "renamed-pattern-destructure",
      code: "interface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  const renderText = () => {\n    const { pattern: matcher } = props;\n    if (matcher) {\n      return props.text.split(matcher).map((segment, index) =>\n        segment.match(matcher) ? <b key={index}>{segment}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <div>{renderText()}</div>;\n};\n",
    },
    {
      name: "direct-component-text-return",
      code: "interface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  const { pattern } = props;\n  if (pattern) {\n      return props.text.split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <b key={index}>{segment}</b> : segment,\n      );\n    }\n  return props.text;\n\n};\n",
    },
    {
      name: "ordinary-optional-capture-text",
      code: 'interface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  const renderText = () => {\n    const { pattern } = props;\n    if (pattern) {\n      return props.text.split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <b key={index}>{segment}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <div>{renderText()}</div>;\n};\n<HighlightedLabel text="a" pattern={/(x)?a/} />;\n',
    },
    {
      name: "literal-class-name-only",
      code: 'interface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  const renderText = () => {\n    const { pattern } = props;\n    if (pattern) {\n      return props.text.split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <b className="emphasis" key={index}>{segment}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <div>{renderText()}</div>;\n};\n',
    },
  ])("allows a closed text run: $name", ({ code }) => {
    const result = runRule(noArrayIndexAsKey, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
  it.each([
    {
      name: "leaf-event",
      code: "interface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  const renderText = () => {\n    const { pattern } = props;\n    if (pattern) {\n      return props.text.split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <b key={index} onClick={() => choose(segment)}>{segment}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <div>{renderText()}</div>;\n};\n",
    },
    {
      name: "leaf-ref",
      code: "interface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  const renderText = () => {\n    const { pattern } = props;\n    if (pattern) {\n      return props.text.split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <b key={index} ref={elementRef}>{segment}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <div>{renderText()}</div>;\n};\n",
    },
    {
      name: "leaf-spread",
      code: "interface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  const renderText = () => {\n    const { pattern } = props;\n    if (pattern) {\n      return props.text.split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <b {...attributes} key={index}>{segment}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <div>{renderText()}</div>;\n};\n",
    },
    {
      name: "stateful-descendant",
      code: "interface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  const renderText = () => {\n    const { pattern } = props;\n    if (pattern) {\n      return props.text.split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <b key={index}><input value={segment} /></b> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <div>{renderText()}</div>;\n};\n",
    },
    {
      name: "custom-component",
      code: "interface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  const renderText = () => {\n    const { pattern } = props;\n    if (pattern) {\n      return props.text.split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <TextItem key={index} value={segment} /> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <div>{renderText()}</div>;\n};\n",
    },
    {
      name: "unknown-string-type",
      code: "interface TextProps {\n  text: unknown;\n  pattern?: RegExp | null;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  const renderText = () => {\n    const { pattern } = props;\n    if (pattern) {\n      return props.text.split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <b key={index}>{segment}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <div>{renderText()}</div>;\n};\n",
    },
    {
      name: "optional-string",
      code: "interface TextProps {\n  text?: string;\n  pattern?: RegExp | null;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  const renderText = () => {\n    const { pattern } = props;\n    if (pattern) {\n      return props.text.split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <b key={index}>{segment}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <div>{renderText()}</div>;\n};\n",
    },
    {
      name: "ambiguous-interface",
      code: "interface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n}\ninterface TextProps { text: number; }\nexport const HighlightedLabel = (props: TextProps) => {\n  const renderText = () => {\n    const { pattern } = props;\n    if (pattern) {\n      return props.text.split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <b key={index}>{segment}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <div>{renderText()}</div>;\n};\n",
    },
    {
      name: "unknown-pattern-type",
      code: "interface TextProps {\n  text: string;\n  pattern?: unknown;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  const renderText = () => {\n    const { pattern } = props;\n    if (pattern) {\n      return props.text.split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <b key={index}>{segment}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <div>{renderText()}</div>;\n};\n",
    },
    {
      name: "computed-receiver",
      code: "interface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  const renderText = () => {\n    const { pattern } = props;\n    if (pattern) {\n      return props[field].split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <b key={index}>{segment}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <div>{renderText()}</div>;\n};\n",
    },
    {
      name: "optional-split",
      code: "interface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  const renderText = () => {\n    const { pattern } = props;\n    if (pattern) {\n      return props.text?.split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <b key={index}>{segment}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <div>{renderText()}</div>;\n};\n",
    },
    {
      name: "pattern-reassignment",
      code: "interface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  const renderText = () => {\n    let { pattern } = props;\n    pattern = nextPattern;\n    if (pattern) {\n      return props.text.split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <b key={index}>{segment}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <div>{renderText()}</div>;\n};\n",
    },
    {
      name: "symbol-split-override",
      code: "interface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  const renderText = () => {\n    const { pattern } = props;\n    if (pattern) {\n      pattern[Symbol.split] = customSplit;\n      return props.text.split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <b key={index}>{segment}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <div>{renderText()}</div>;\n};\n",
    },
    {
      name: "alias-exec-override",
      code: "interface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  const renderText = () => {\n    const { pattern } = props;\n    if (pattern) {\n      const patternAlias = pattern;\n      patternAlias.exec = customExec;\n      return props.text.split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <b key={index}>{segment}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <div>{renderText()}</div>;\n};\n",
    },
    {
      name: "pattern-escape",
      code: "interface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  const renderText = () => {\n    const { pattern } = props;\n    if (pattern) {\n      configure(pattern);\n      return props.text.split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <b key={index}>{segment}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <div>{renderText()}</div>;\n};\n",
    },
    {
      name: "props-escape",
      code: "interface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  publish(props);\n  const renderText = () => {\n    const { pattern } = props;\n    if (pattern) {\n      return props.text.split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <b key={index}>{segment}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <div>{renderText()}</div>;\n};\n",
    },
    {
      name: "helper-alias",
      code: "interface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  const renderText = () => {\n    const { pattern } = props;\n    if (pattern) {\n      return props.text.split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <b key={index}>{segment}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  const alias = renderText;\n  return <div>{alias()}</div>;\n};\n",
    },
    {
      name: "helper-multiple-calls",
      code: "interface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  const renderText = () => {\n    const { pattern } = props;\n    if (pattern) {\n      return props.text.split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <b key={index}>{segment}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <div>{renderText()}{renderText()}</div>;\n};\n",
    },
    {
      name: "helper-deferred-event",
      code: "interface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  const renderText = () => {\n    const { pattern } = props;\n    if (pattern) {\n      return props.text.split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <b key={index}>{segment}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <div onClick={renderText} />;\n};\n",
    },
    {
      name: "helper-arguments",
      code: "interface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  const renderText = () => {\n    const { pattern } = props;\n    if (pattern) {\n      return props.text.split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <b key={index}>{segment}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <div>{renderText(props.text)}</div>;\n};\n",
    },
    {
      name: "local-function-wrong-props-owner",
      code: "interface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  const renderText = (props: TextProps) => {\n    const { pattern } = props;\n    if (pattern) {\n      return props.text.split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <b key={index}>{segment}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <div>{renderText()}</div>;\n};\n",
    },
    {
      name: "index-not-key-only",
      code: "interface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  const renderText = () => {\n    const { pattern } = props;\n    if (pattern) {\n      return props.text.split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <b key={index}>{segment}{index}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <div>{renderText()}</div>;\n};\n",
    },
    {
      name: "collection-escape",
      code: "interface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  const renderText = () => {\n    const { pattern } = props;\n    if (pattern) {\n      return props.text.split(pattern).map((segment, index, collection) =>\n        publish(collection) || segment.match(pattern) ? <b key={index}>{segment}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <div>{renderText()}</div>;\n};\n",
    },
    {
      name: "unknown-predicate",
      code: "interface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  const renderText = () => {\n    const { pattern } = props;\n    if (pattern) {\n      return props.text.split(pattern).map((segment, index) =>\n        evaluate(segment, pattern) ? <b key={index}>{segment}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <div>{renderText()}</div>;\n};\n",
    },
    {
      name: "property-write",
      code: "interface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  props.text = changedText;\n  const renderText = () => {\n    const { pattern } = props;\n    if (pattern) {\n      return props.text.split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <b key={index}>{segment}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <div>{renderText()}</div>;\n};\n",
    },
    {
      name: "hoc-wrapper-outside-supported-owner",
      code: "interface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n}\nexport const HighlightedLabel = memo((props: TextProps) => {\n  const renderText = () => {\n    const { pattern } = props;\n    if (pattern) {\n      return props.text.split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <b key={index}>{segment}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <div>{renderText()}</div>;\n});\n",
    },
    {
      name: "local-regexp-type-is-not-intrinsic",
      code: "interface RegExp { custom: string; }\ninterface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  const renderText = () => {\n    const { pattern } = props;\n    if (pattern) {\n      return props.text.split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <b key={index}>{segment}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <div>{renderText()}</div>;\n};\n",
    },
    {
      name: "global-protocol-alias-write",
      code: "const prototypeAlias = RegExp.prototype;\nprototypeAlias.exec = customExec;\ninterface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  const renderText = () => {\n    const { pattern } = props;\n    if (pattern) {\n      return props.text.split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <b key={index}>{segment}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <div>{renderText()}</div>;\n};\n",
    },
    {
      name: "string-prototype-override",
      code: "String.prototype.split = customSplit;\ninterface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  const renderText = () => {\n    const { pattern } = props;\n    if (pattern) {\n      return props.text.split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <b key={index}>{segment}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <div>{renderText()}</div>;\n};\n",
    },
    {
      name: "props-pattern-nested-write",
      code: "interface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  props.pattern.exec = customExec;\n  const renderText = () => {\n    const { pattern } = props;\n    if (pattern) {\n      return props.text.split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <b key={index}>{segment}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <div>{renderText()}</div>;\n};\n",
    },
    {
      name: "pattern-object-alias-write",
      code: "interface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  const renderText = () => {\n    const { pattern } = props;\n    const alias = pattern;\n    if (pattern) {\n      alias.exec = customExec;\n      return props.text.split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <b key={index}>{segment}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <div>{renderText()}</div>;\n};\n",
    },
    {
      name: "pattern-defined-by-aliased-mutator",
      code: 'interface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  const renderText = () => {\n    const { pattern } = props;\n    const define = Object.defineProperty;\n    if (pattern) {\n      define(pattern, "exec", { value: customExec });\n      return props.text.split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <b key={index}>{segment}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <div>{renderText()}</div>;\n};\n',
    },
    {
      name: "unused-third-map-parameter-not-in-initial-contract",
      code: "interface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  const renderText = () => {\n    const { pattern } = props;\n    if (pattern) {\n      return props.text.split(pattern).map((segment, index, collection) =>\n        segment.match(pattern) ? <b key={index}>{segment}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <div>{renderText()}</div>;\n};\n",
    },
  ])("keeps an unproven or stateful run diagnostic: $name", ({ code }) => {
    const result = runRule(noArrayIndexAsKey, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});

describe("opaque props calls and text protocol overrides", () => {
  it.each([
    {
      name: "named-returned-dom-event-only",
      code: "interface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n  onSelect?(text: string): void;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  const handleSelect = () => {\n    if (props.onSelect) props.onSelect(props.text);\n  };\n  const renderText = () => {\n    const { pattern } = props;\n    if (pattern) {\n      return props.text.split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <b key={index}>{segment}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <div onClick={handleSelect}>{renderText()}</div>;\n};\n",
    },
    {
      name: "inline-returned-dom-event-only",
      code: "interface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n  onSelect?(text: string): void;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  const renderText = () => {\n    const { pattern } = props;\n    if (pattern) {\n      return props.text.split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <b key={index}>{segment}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <div onClick={() => { if (props.onSelect) props.onSelect(props.text); }}>{renderText()}</div>;\n};\n",
    },
    {
      name: "sibling-component-value-not-invoked-during-render",
      code: 'import React from "react";\ninterface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n  component: React.ComponentType;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  const Component = props.component;\n  if (!Component) { return null; }\n  const renderText = () => {\n    const { pattern } = props;\n    if (pattern) {\n      return props.text.split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <b key={index}>{segment}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <div><Component />{renderText()}</div>;\n};\n',
    },
  ])("allows structurally deferred sibling uses: $name", ({ code }) => {
    const result = runRule(noArrayIndexAsKey, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
  it.each([
    {
      name: "eager-props-receiver-call",
      code: "interface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n  prepare(): void;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  props.prepare();\n  const renderText = () => {\n    const { pattern } = props;\n    if (pattern) {\n      return props.text.split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <b key={index}>{segment}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <div>{renderText()}</div>;\n};\n",
    },
    {
      name: "eager-props-method-alias",
      code: "interface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n  prepare(): void;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  const prepare = props.prepare;\n  prepare();\n  const renderText = () => {\n    const { pattern } = props;\n    if (pattern) {\n      return props.text.split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <b key={index}>{segment}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <div>{renderText()}</div>;\n};\n",
    },
    {
      name: "props-member-chain-call",
      code: "interface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  props.tools.prepare();\n  const renderText = () => {\n    const { pattern } = props;\n    if (pattern) {\n      return props.text.split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <b key={index}>{segment}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <div>{renderText()}</div>;\n};\n",
    },
    {
      name: "array-map-override",
      code: "Array.prototype.map = customMap;\ninterface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  const renderText = () => {\n    const { pattern } = props;\n    if (pattern) {\n      return props.text.split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <b key={index}>{segment}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <div>{renderText()}</div>;\n};\n",
    },
    {
      name: "array-map-alias-override",
      code: "const arrayPrototype = Array.prototype;\narrayPrototype.map = customMap;\ninterface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  const renderText = () => {\n    const { pattern } = props;\n    if (pattern) {\n      return props.text.split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <b key={index}>{segment}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <div>{renderText()}</div>;\n};\n",
    },
    {
      name: "custom-component-event-not-proven-deferred",
      code: "interface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n  onSelect?(text: string): void;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  const handleSelect = () => {\n    if (props.onSelect) props.onSelect(props.text);\n  };\n  const renderText = () => {\n    const { pattern } = props;\n    if (pattern) {\n      return props.text.split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <b key={index}>{segment}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <EventHost onClick={handleSelect}>{renderText()}</EventHost>;\n};\n",
    },
    {
      name: "event-handler-also-called-eagerly",
      code: "interface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n  onSelect?(text: string): void;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  const handleSelect = () => {\n    if (props.onSelect) props.onSelect(props.text);\n  };\n  const renderText = () => {\n    const { pattern } = props;\n    if (pattern) {\n      return props.text.split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <b key={index}>{segment}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  handleSelect();\n  return <div onClick={handleSelect}>{renderText()}</div>;\n};\n",
    },
    {
      name: "event-jsx-value-escapes",
      code: "interface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n  onSelect?(text: string): void;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  const handleSelect = () => {\n    if (props.onSelect) props.onSelect(props.text);\n  };\n  const renderText = () => {\n    const { pattern } = props;\n    if (pattern) {\n      return props.text.split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <b key={index}>{segment}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  const view = <div onClick={handleSelect} />;\n  publish(view);\n  return <div>{renderText()}</div>;\n};\n",
    },
  ])("does not exempt eager or unproven mutation routes: $name", ({ code }) => {
    const result = runRule(noArrayIndexAsKey, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});

describe("ordinary text protocol access refusals", () => {
  it.each([
    {
      name: "array-literal-constructor-map",
      code: "[].constructor.prototype.map = customMap;\ninterface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  const renderText = () => {\n    const { pattern } = props;\n    if (pattern) {\n      return props.text.split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <b key={index}>{segment}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <div>{renderText()}</div>;\n};\n",
    },
    {
      name: "array-literal-constructor-alias",
      code: "const arrayPrototype = [].constructor.prototype;\narrayPrototype.map = customMap;\ninterface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  const renderText = () => {\n    const { pattern } = props;\n    if (pattern) {\n      return props.text.split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <b key={index}>{segment}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <div>{renderText()}</div>;\n};\n",
    },
    {
      name: "array-literal-proto-map",
      code: "[].__proto__.map = customMap;\ninterface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  const renderText = () => {\n    const { pattern } = props;\n    if (pattern) {\n      return props.text.split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <b key={index}>{segment}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <div>{renderText()}</div>;\n};\n",
    },
    {
      name: "array-literal-proto-alias",
      code: "const arrayPrototype = [].__proto__;\narrayPrototype.map = customMap;\ninterface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  const renderText = () => {\n    const { pattern } = props;\n    if (pattern) {\n      return props.text.split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <b key={index}>{segment}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <div>{renderText()}</div>;\n};\n",
    },
    {
      name: "string-literal-constructor-split",
      code: '"".constructor.prototype.split = customSplit;\ninterface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  const renderText = () => {\n    const { pattern } = props;\n    if (pattern) {\n      return props.text.split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <b key={index}>{segment}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <div>{renderText()}</div>;\n};\n',
    },
    {
      name: "string-literal-constructor-alias",
      code: 'const stringPrototype = "".constructor.prototype;\nstringPrototype.split = customSplit;\ninterface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  const renderText = () => {\n    const { pattern } = props;\n    if (pattern) {\n      return props.text.split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <b key={index}>{segment}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <div>{renderText()}</div>;\n};\n',
    },
    {
      name: "string-literal-proto-split",
      code: '"".__proto__.split = customSplit;\ninterface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  const renderText = () => {\n    const { pattern } = props;\n    if (pattern) {\n      return props.text.split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <b key={index}>{segment}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <div>{renderText()}</div>;\n};\n',
    },
    {
      name: "regexp-literal-constructor-exec",
      code: "/x/.constructor.prototype.exec = customExec;\ninterface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  const renderText = () => {\n    const { pattern } = props;\n    if (pattern) {\n      return props.text.split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <b key={index}>{segment}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <div>{renderText()}</div>;\n};\n",
    },
    {
      name: "regexp-literal-constructor-alias",
      code: "const regexpPrototype = /x/.constructor.prototype;\nregexpPrototype.exec = customExec;\ninterface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  const renderText = () => {\n    const { pattern } = props;\n    if (pattern) {\n      return props.text.split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <b key={index}>{segment}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <div>{renderText()}</div>;\n};\n",
    },
    {
      name: "regexp-literal-proto-exec",
      code: "/x/.__proto__.exec = customExec;\ninterface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  const renderText = () => {\n    const { pattern } = props;\n    if (pattern) {\n      return props.text.split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <b key={index}>{segment}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <div>{renderText()}</div>;\n};\n",
    },
    {
      name: "computed-protocol-alias",
      code: "const protocol = [][protocolName];\nprotocol.map = customMap;\ninterface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  const renderText = () => {\n    const { pattern } = props;\n    if (pattern) {\n      return props.text.split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <b key={index}>{segment}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <div>{renderText()}</div>;\n};\n",
    },
    {
      name: "computed-literal-protocol",
      code: '[]["constructor"]["prototype"].map = customMap;\ninterface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  const renderText = () => {\n    const { pattern } = props;\n    if (pattern) {\n      return props.text.split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <b key={index}>{segment}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <div>{renderText()}</div>;\n};\n',
    },
  ])("does not exempt visible protocol access: $name", ({ code }) => {
    const result = runRule(noArrayIndexAsKey, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});

describe("guarded render-helper JSX ancestor boundary", () => {
  it.each([
    {
      name: "intrinsic-parent-kept",
      expectedDiagnostics: 0,
      code: 'import { Fragment, type DetailedHTMLProps, type HTMLAttributes, type ReactNode } from "react";\ndeclare module "react" {\n  namespace JSX {\n    interface IntrinsicElements {\n      "editable-surface": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;\n      "stateful-token": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;\n    }\n  }\n}\nconst choose = (value: string): void => { void value; };\nconst attributes = { contentEditable: true } as const;\nconst EditableSurface = ({ children }: { children: ReactNode }) => <div contentEditable>{children}</div>;\nconst UI = { EditableSurface };\nconst containerRef = (element: HTMLDivElement | null): void => {\n  if (element) element.contentEditable = "true";\n};\ninterface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  const renderText = () => {\n    const { pattern } = props;\n    if (pattern) {\n      return props.text.split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <b key={index}>{segment}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <div>{renderText()}</div>;\n};\n',
    },
    {
      name: "intrinsic-button-outer-event-kept",
      expectedDiagnostics: 0,
      code: 'import { Fragment, type DetailedHTMLProps, type HTMLAttributes, type ReactNode } from "react";\ndeclare module "react" {\n  namespace JSX {\n    interface IntrinsicElements {\n      "editable-surface": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;\n      "stateful-token": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;\n    }\n  }\n}\nconst choose = (value: string): void => { void value; };\nconst attributes = { contentEditable: true } as const;\nconst EditableSurface = ({ children }: { children: ReactNode }) => <div contentEditable>{children}</div>;\nconst UI = { EditableSurface };\nconst containerRef = (element: HTMLDivElement | null): void => {\n  if (element) element.contentEditable = "true";\n};\ninterface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  const renderText = () => {\n    const { pattern } = props;\n    if (pattern) {\n      return props.text.split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <b key={index}>{segment}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <button onClick={() => choose(props.text)}>{renderText()}</button>;\n};\n',
    },
    {
      name: "fragment-parent-kept",
      expectedDiagnostics: 0,
      code: 'import { Fragment, type DetailedHTMLProps, type HTMLAttributes, type ReactNode } from "react";\ndeclare module "react" {\n  namespace JSX {\n    interface IntrinsicElements {\n      "editable-surface": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;\n      "stateful-token": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;\n    }\n  }\n}\nconst choose = (value: string): void => { void value; };\nconst attributes = { contentEditable: true } as const;\nconst EditableSurface = ({ children }: { children: ReactNode }) => <div contentEditable>{children}</div>;\nconst UI = { EditableSurface };\nconst containerRef = (element: HTMLDivElement | null): void => {\n  if (element) element.contentEditable = "true";\n};\ninterface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  const renderText = () => {\n    const { pattern } = props;\n    if (pattern) {\n      return props.text.split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <b key={index}>{segment}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <>{renderText()}</>;\n};\n',
    },
    {
      name: "imported-fragment-parent-kept",
      expectedDiagnostics: 0,
      code: 'import { Fragment, type DetailedHTMLProps, type HTMLAttributes, type ReactNode } from "react";\ndeclare module "react" {\n  namespace JSX {\n    interface IntrinsicElements {\n      "editable-surface": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;\n      "stateful-token": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;\n    }\n  }\n}\nconst choose = (value: string): void => { void value; };\nconst attributes = { contentEditable: true } as const;\nconst EditableSurface = ({ children }: { children: ReactNode }) => <div contentEditable>{children}</div>;\nconst UI = { EditableSurface };\nconst containerRef = (element: HTMLDivElement | null): void => {\n  if (element) element.contentEditable = "true";\n};\ninterface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  const renderText = () => {\n    const { pattern } = props;\n    if (pattern) {\n      return props.text.split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <b key={index}>{segment}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <Fragment>{renderText()}</Fragment>;\n};\n',
    },
    {
      name: "false-editable-parent-kept",
      expectedDiagnostics: 0,
      code: 'import { Fragment, type DetailedHTMLProps, type HTMLAttributes, type ReactNode } from "react";\ndeclare module "react" {\n  namespace JSX {\n    interface IntrinsicElements {\n      "editable-surface": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;\n      "stateful-token": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;\n    }\n  }\n}\nconst choose = (value: string): void => { void value; };\nconst attributes = { contentEditable: true } as const;\nconst EditableSurface = ({ children }: { children: ReactNode }) => <div contentEditable>{children}</div>;\nconst UI = { EditableSurface };\nconst containerRef = (element: HTMLDivElement | null): void => {\n  if (element) element.contentEditable = "true";\n};\ninterface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  const renderText = () => {\n    const { pattern } = props;\n    if (pattern) {\n      return props.text.split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <b key={index}>{segment}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <div contentEditable={false}>{renderText()}</div>;\n};\n',
    },
    {
      name: "false-string-editable-parent-kept",
      expectedDiagnostics: 0,
      code: 'import { Fragment, type DetailedHTMLProps, type HTMLAttributes, type ReactNode } from "react";\ndeclare module "react" {\n  namespace JSX {\n    interface IntrinsicElements {\n      "editable-surface": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;\n      "stateful-token": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;\n    }\n  }\n}\nconst choose = (value: string): void => { void value; };\nconst attributes = { contentEditable: true } as const;\nconst EditableSurface = ({ children }: { children: ReactNode }) => <div contentEditable>{children}</div>;\nconst UI = { EditableSurface };\nconst containerRef = (element: HTMLDivElement | null): void => {\n  if (element) element.contentEditable = "true";\n};\ninterface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  const renderText = () => {\n    const { pattern } = props;\n    if (pattern) {\n      return props.text.split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <b key={index}>{segment}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <div contentEditable="false">{renderText()}</div>;\n};\n',
    },
    {
      name: "editable-parent",
      expectedDiagnostics: 1,
      code: 'import { Fragment, type DetailedHTMLProps, type HTMLAttributes, type ReactNode } from "react";\ndeclare module "react" {\n  namespace JSX {\n    interface IntrinsicElements {\n      "editable-surface": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;\n      "stateful-token": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;\n    }\n  }\n}\nconst choose = (value: string): void => { void value; };\nconst attributes = { contentEditable: true } as const;\nconst EditableSurface = ({ children }: { children: ReactNode }) => <div contentEditable>{children}</div>;\nconst UI = { EditableSurface };\nconst containerRef = (element: HTMLDivElement | null): void => {\n  if (element) element.contentEditable = "true";\n};\ninterface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  const renderText = () => {\n    const { pattern } = props;\n    if (pattern) {\n      return props.text.split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <b key={index}>{segment}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <div contentEditable>{renderText()}</div>;\n};\n',
    },
    {
      name: "editable-grandparent",
      expectedDiagnostics: 1,
      code: 'import { Fragment, type DetailedHTMLProps, type HTMLAttributes, type ReactNode } from "react";\ndeclare module "react" {\n  namespace JSX {\n    interface IntrinsicElements {\n      "editable-surface": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;\n      "stateful-token": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;\n    }\n  }\n}\nconst choose = (value: string): void => { void value; };\nconst attributes = { contentEditable: true } as const;\nconst EditableSurface = ({ children }: { children: ReactNode }) => <div contentEditable>{children}</div>;\nconst UI = { EditableSurface };\nconst containerRef = (element: HTMLDivElement | null): void => {\n  if (element) element.contentEditable = "true";\n};\ninterface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  const renderText = () => {\n    const { pattern } = props;\n    if (pattern) {\n      return props.text.split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <b key={index}>{segment}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <div contentEditable><span>{renderText()}</span></div>;\n};\n',
    },
    {
      name: "editable-inherit-parent",
      expectedDiagnostics: 1,
      code: 'import { Fragment, type DetailedHTMLProps, type HTMLAttributes, type ReactNode } from "react";\ndeclare module "react" {\n  namespace JSX {\n    interface IntrinsicElements {\n      "editable-surface": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;\n      "stateful-token": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;\n    }\n  }\n}\nconst choose = (value: string): void => { void value; };\nconst attributes = { contentEditable: true } as const;\nconst EditableSurface = ({ children }: { children: ReactNode }) => <div contentEditable>{children}</div>;\nconst UI = { EditableSurface };\nconst containerRef = (element: HTMLDivElement | null): void => {\n  if (element) element.contentEditable = "true";\n};\ninterface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  const renderText = () => {\n    const { pattern } = props;\n    if (pattern) {\n      return props.text.split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <b key={index}>{segment}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <div contentEditable="inherit">{renderText()}</div>;\n};\n',
    },
    {
      name: "spread-parent",
      expectedDiagnostics: 1,
      code: 'import { Fragment, type DetailedHTMLProps, type HTMLAttributes, type ReactNode } from "react";\ndeclare module "react" {\n  namespace JSX {\n    interface IntrinsicElements {\n      "editable-surface": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;\n      "stateful-token": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;\n    }\n  }\n}\nconst choose = (value: string): void => { void value; };\nconst attributes = { contentEditable: true } as const;\nconst EditableSurface = ({ children }: { children: ReactNode }) => <div contentEditable>{children}</div>;\nconst UI = { EditableSurface };\nconst containerRef = (element: HTMLDivElement | null): void => {\n  if (element) element.contentEditable = "true";\n};\ninterface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  const renderText = () => {\n    const { pattern } = props;\n    if (pattern) {\n      return props.text.split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <b key={index}>{segment}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <div {...attributes}>{renderText()}</div>;\n};\n',
    },
    {
      name: "opaque-composite-parent",
      expectedDiagnostics: 1,
      code: 'import { Fragment, type DetailedHTMLProps, type HTMLAttributes, type ReactNode } from "react";\ndeclare module "react" {\n  namespace JSX {\n    interface IntrinsicElements {\n      "editable-surface": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;\n      "stateful-token": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;\n    }\n  }\n}\nconst choose = (value: string): void => { void value; };\nconst attributes = { contentEditable: true } as const;\nconst EditableSurface = ({ children }: { children: ReactNode }) => <div contentEditable>{children}</div>;\nconst UI = { EditableSurface };\nconst containerRef = (element: HTMLDivElement | null): void => {\n  if (element) element.contentEditable = "true";\n};\ninterface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  const renderText = () => {\n    const { pattern } = props;\n    if (pattern) {\n      return props.text.split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <b key={index}>{segment}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <EditableSurface>{renderText()}</EditableSurface>;\n};\n',
    },
    {
      name: "member-composite-parent",
      expectedDiagnostics: 1,
      code: 'import { Fragment, type DetailedHTMLProps, type HTMLAttributes, type ReactNode } from "react";\ndeclare module "react" {\n  namespace JSX {\n    interface IntrinsicElements {\n      "editable-surface": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;\n      "stateful-token": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;\n    }\n  }\n}\nconst choose = (value: string): void => { void value; };\nconst attributes = { contentEditable: true } as const;\nconst EditableSurface = ({ children }: { children: ReactNode }) => <div contentEditable>{children}</div>;\nconst UI = { EditableSurface };\nconst containerRef = (element: HTMLDivElement | null): void => {\n  if (element) element.contentEditable = "true";\n};\ninterface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  const renderText = () => {\n    const { pattern } = props;\n    if (pattern) {\n      return props.text.split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <b key={index}>{segment}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <UI.EditableSurface>{renderText()}</UI.EditableSurface>;\n};\n',
    },
    {
      name: "custom-element-parent",
      expectedDiagnostics: 1,
      code: 'import { Fragment, type DetailedHTMLProps, type HTMLAttributes, type ReactNode } from "react";\ndeclare module "react" {\n  namespace JSX {\n    interface IntrinsicElements {\n      "editable-surface": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;\n      "stateful-token": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;\n    }\n  }\n}\nconst choose = (value: string): void => { void value; };\nconst attributes = { contentEditable: true } as const;\nconst EditableSurface = ({ children }: { children: ReactNode }) => <div contentEditable>{children}</div>;\nconst UI = { EditableSurface };\nconst containerRef = (element: HTMLDivElement | null): void => {\n  if (element) element.contentEditable = "true";\n};\ninterface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  const renderText = () => {\n    const { pattern } = props;\n    if (pattern) {\n      return props.text.split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <b key={index}>{segment}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <editable-surface>{renderText()}</editable-surface>;\n};\n',
    },
    {
      name: "customized-intrinsic-parent",
      expectedDiagnostics: 1,
      code: 'import { Fragment, type DetailedHTMLProps, type HTMLAttributes, type ReactNode } from "react";\ndeclare module "react" {\n  namespace JSX {\n    interface IntrinsicElements {\n      "editable-surface": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;\n      "stateful-token": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;\n    }\n  }\n}\nconst choose = (value: string): void => { void value; };\nconst attributes = { contentEditable: true } as const;\nconst EditableSurface = ({ children }: { children: ReactNode }) => <div contentEditable>{children}</div>;\nconst UI = { EditableSurface };\nconst containerRef = (element: HTMLDivElement | null): void => {\n  if (element) element.contentEditable = "true";\n};\ninterface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  const renderText = () => {\n    const { pattern } = props;\n    if (pattern) {\n      return props.text.split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <b key={index}>{segment}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <div is="editable-surface">{renderText()}</div>;\n};\n',
    },
    {
      name: "ref-parent",
      expectedDiagnostics: 1,
      code: 'import { Fragment, type DetailedHTMLProps, type HTMLAttributes, type ReactNode } from "react";\ndeclare module "react" {\n  namespace JSX {\n    interface IntrinsicElements {\n      "editable-surface": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;\n      "stateful-token": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;\n    }\n  }\n}\nconst choose = (value: string): void => { void value; };\nconst attributes = { contentEditable: true } as const;\nconst EditableSurface = ({ children }: { children: ReactNode }) => <div contentEditable>{children}</div>;\nconst UI = { EditableSurface };\nconst containerRef = (element: HTMLDivElement | null): void => {\n  if (element) element.contentEditable = "true";\n};\ninterface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  const renderText = () => {\n    const { pattern } = props;\n    if (pattern) {\n      return props.text.split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <b key={index}>{segment}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <div ref={containerRef}>{renderText()}</div>;\n};\n',
    },
    {
      name: "opaque-parent-around-fragment",
      expectedDiagnostics: 1,
      code: 'import { Fragment, type DetailedHTMLProps, type HTMLAttributes, type ReactNode } from "react";\ndeclare module "react" {\n  namespace JSX {\n    interface IntrinsicElements {\n      "editable-surface": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;\n      "stateful-token": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;\n    }\n  }\n}\nconst choose = (value: string): void => { void value; };\nconst attributes = { contentEditable: true } as const;\nconst EditableSurface = ({ children }: { children: ReactNode }) => <div contentEditable>{children}</div>;\nconst UI = { EditableSurface };\nconst containerRef = (element: HTMLDivElement | null): void => {\n  if (element) element.contentEditable = "true";\n};\ninterface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  const renderText = () => {\n    const { pattern } = props;\n    if (pattern) {\n      return props.text.split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <b key={index}>{segment}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <EditableSurface><>{renderText()}</></EditableSurface>;\n};\n',
    },
    {
      name: "own-lowercase-custom-element-leaf",
      expectedDiagnostics: 1,
      code: 'import { Fragment, type DetailedHTMLProps, type HTMLAttributes, type ReactNode } from "react";\ndeclare module "react" {\n  namespace JSX {\n    interface IntrinsicElements {\n      "editable-surface": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;\n      "stateful-token": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;\n    }\n  }\n}\nconst choose = (value: string): void => { void value; };\nconst attributes = { contentEditable: true } as const;\nconst EditableSurface = ({ children }: { children: ReactNode }) => <div contentEditable>{children}</div>;\nconst UI = { EditableSurface };\nconst containerRef = (element: HTMLDivElement | null): void => {\n  if (element) element.contentEditable = "true";\n};\ninterface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  const renderText = () => {\n    const { pattern } = props;\n    if (pattern) {\n      return props.text.split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <stateful-token key={index}>{segment}</stateful-token> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <div>{renderText()}</div>;\n};\n',
    },
    {
      name: "named-fragment-const-alias-kept",
      expectedDiagnostics: 0,
      code: 'import { Fragment, type DetailedHTMLProps, type HTMLAttributes, type ReactNode } from "react";\ndeclare module "react" {\n  namespace JSX {\n    interface IntrinsicElements {\n      "editable-surface": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;\n      "stateful-token": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;\n    }\n  }\n}\nconst choose = (value: string): void => { void value; };\nconst attributes = { contentEditable: true } as const;\nconst EditableSurface = ({ children }: { children: ReactNode }) => <div contentEditable>{children}</div>;\nconst UI = { EditableSurface };\nconst containerRef = (element: HTMLDivElement | null): void => {\n  if (element) element.contentEditable = "true";\n};\nconst Frame = Fragment;\ninterface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  const renderText = () => {\n    const { pattern } = props;\n    if (pattern) {\n      return props.text.split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <b key={index}>{segment}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <Frame>{renderText()}</Frame>;\n};\n',
    },
    {
      name: "named-fragment-ref-parent",
      expectedDiagnostics: 1,
      code: 'import { Fragment, type DetailedHTMLProps, type HTMLAttributes, type ReactNode } from "react";\ndeclare module "react" {\n  namespace JSX {\n    interface IntrinsicElements {\n      "editable-surface": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;\n      "stateful-token": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;\n    }\n  }\n}\nconst choose = (value: string): void => { void value; };\nconst attributes = { contentEditable: true } as const;\nconst EditableSurface = ({ children }: { children: ReactNode }) => <div contentEditable>{children}</div>;\nconst UI = { EditableSurface };\nconst containerRef = (element: HTMLDivElement | null): void => {\n  if (element) element.contentEditable = "true";\n};\ndeclare module "react" {\n  interface FragmentProps {\n    ref?: (element: HTMLDivElement | null) => void;\n  }\n}\ninterface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  const renderText = () => {\n    const { pattern } = props;\n    if (pattern) {\n      return props.text.split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <b key={index}>{segment}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <Fragment ref={containerRef}>{renderText()}</Fragment>;\n};\n',
    },
    {
      name: "named-fragment-spread-ref-parent",
      expectedDiagnostics: 1,
      code: 'import { Fragment, type DetailedHTMLProps, type HTMLAttributes, type ReactNode } from "react";\ndeclare module "react" {\n  namespace JSX {\n    interface IntrinsicElements {\n      "editable-surface": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;\n      "stateful-token": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;\n    }\n  }\n}\nconst choose = (value: string): void => { void value; };\nconst attributes = { contentEditable: true } as const;\nconst EditableSurface = ({ children }: { children: ReactNode }) => <div contentEditable>{children}</div>;\nconst UI = { EditableSurface };\nconst containerRef = (element: HTMLDivElement | null): void => {\n  if (element) element.contentEditable = "true";\n};\ndeclare module "react" {\n  interface FragmentProps {\n    ref?: (element: HTMLDivElement | null) => void;\n  }\n}\nconst fragmentAttributes = { ref: containerRef };\ninterface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  const renderText = () => {\n    const { pattern } = props;\n    if (pattern) {\n      return props.text.split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <b key={index}>{segment}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <Fragment {...fragmentAttributes}>{renderText()}</Fragment>;\n};\n',
    },
    {
      name: "namespace-fragment-stays-opaque-without-closure-proof",
      expectedDiagnostics: 1,
      code: 'import * as React from "react";\nimport { Fragment, type DetailedHTMLProps, type HTMLAttributes, type ReactNode } from "react";\ndeclare module "react" {\n  namespace JSX {\n    interface IntrinsicElements {\n      "editable-surface": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;\n      "stateful-token": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;\n    }\n  }\n}\nconst choose = (value: string): void => { void value; };\nconst attributes = { contentEditable: true } as const;\nconst EditableSurface = ({ children }: { children: ReactNode }) => <div contentEditable>{children}</div>;\nconst UI = { EditableSurface };\nconst containerRef = (element: HTMLDivElement | null): void => {\n  if (element) element.contentEditable = "true";\n};\ninterface TextProps {\n  text: string;\n  pattern?: RegExp | null;\n}\nexport const HighlightedLabel = (props: TextProps) => {\n  const renderText = () => {\n    const { pattern } = props;\n    if (pattern) {\n      return props.text.split(pattern).map((segment, index) =>\n        segment.match(pattern) ? <b key={index}>{segment}</b> : segment,\n      );\n    }\n    return props.text;\n  };\n  return <React.Fragment>{renderText()}</React.Fragment>;\n};\n',
    },
  ])("$name", ({ code, expectedDiagnostics }) => {
    const result = runRule(noArrayIndexAsKey, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedDiagnostics);
  });
});
