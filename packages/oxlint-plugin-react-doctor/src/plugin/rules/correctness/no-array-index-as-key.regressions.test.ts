import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noArrayIndexAsKey } from "./no-array-index-as-key.js";

describe("correctness/no-array-index-as-key regressions", () => {
  describe("identifiers named like an index that are NOT the positional index (mined FP cluster)", () => {
    it("stays silent when `index` is destructured from the item itself (cloudscape show-more)", () => {
      const result = runRule(
        noArrayIndexAsKey,
        `const defaultItems = getItems();
const List = () => (
  <ul>
    {defaultItems.map(({ label, index }) => (
      <li key={index} aria-posinset={index + 1}>
        <input value={label} />
      </li>
    ))}
  </ul>
);
`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("stays silent when the single map parameter is the element, not the index (Stories page)", () => {
      const result = runRule(
        noArrayIndexAsKey,
        `const Stories = ({ indexes }) => (
  <div>
    {indexes.map((index) => (
      <Story key={index} index={index} />
    ))}
  </div>
);
`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("stays silent when `index` is a local alias of the item value (quiz progress)", () => {
      const result = runRule(
        noArrayIndexAsKey,
        `const QuizProgress = ({ items, answers }) => (
  <nav>
    {items.map((item, idx) => {
      const index = item;
      const answer = answers[index];
      return <QuizDot key={index} answer={answer} />;
    })}
  </nav>
);
`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("stays silent when `index` is a useState value used as a remount key (useInterval demo)", () => {
      const result = runRule(
        noArrayIndexAsKey,
        `const Demo = () => {
  const [index, setIndex] = useState(0);
  useInterval(() => setIndex((current) => current + 1), 3000);
  return <Greeting key={index} text={GREETINGS[index]} />;
};
`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("stays silent on a template key mixing state values outside any map (thinking indicator)", () => {
      const result = runRule(
        noArrayIndexAsKey,
        `const ThinkingIndicator = ({ verbs }) => {
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState("active");
  return <AnimatedVerb key={\`\${phase}-\${index}\`} verb={verbs[index]} />;
};
`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("stays silent when `index` is a destructured item property with per-item handlers (ant-design-mobile sidebar)", () => {
      const result = runRule(
        noArrayIndexAsKey,
        `const Sidebar = (props) => (
  <div>
    {props.indexItems.map(({ index, brief }) => (
      <SidebarRow key={index} onMouseDown={() => props.onActive(index)}>
        {brief}
      </SidebarRow>
    ))}
  </div>
);
`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });
  });

  describe("static array literal receivers — the list can never reorder (mined FP cluster)", () => {
    it("stays silent on a module const array of object literals mapped with an index key", () => {
      const result = runRule(
        noArrayIndexAsKey,
        `const STEPS = [
  { title: "Install", body: "npm i" },
  { title: "Run", body: "npm start" },
];
const Steps = () => (
  <ol>
    {STEPS.map((step, index) => (
      <StepCard key={index} title={step.title} body={step.body} />
    ))}
  </ol>
);
`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("stays silent on an inline array literal receiver even with stateful children", () => {
      const result = runRule(
        noArrayIndexAsKey,
        `const CountTextOptions = ({ setCountText }) => (
  <div>
    {["18 matches", "36 matches", ""].map((countText, index) => (
      <label key={index}>
        <input type="radio" onChange={() => setCountText(countText)} />
        {countText}
      </label>
    ))}
  </div>
);
`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("still flags when the array literal contains a spread (length can change)", () => {
      const result = runRule(
        noArrayIndexAsKey,
        `const List = ({ items, extra }) => (
  <ul>
    {[...items, extra].map((item, index) => (
      <Row key={index} item={item} />
    ))}
  </ul>
);
`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("still flags when the static-looking binding is mutated elsewhere", () => {
      const result = runRule(
        noArrayIndexAsKey,
        `const rows = [{ id: 1 }, { id: 2 }];
const addRow = (row) => {
  rows.push(row);
};
const Table = () => (
  <tbody>
    {rows.map((row, index) => (
      <RowView key={index} row={row} />
    ))}
  </tbody>
);
`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("still flags when the static-looking binding is sorted in place", () => {
      const result = runRule(
        noArrayIndexAsKey,
        `const Scores = ({ order }) => {
  const scores = [{ value: 3 }, { value: 1 }];
  scores.sort((a, b) => (order === "asc" ? a.value - b.value : b.value - a.value));
  return scores.map((score, index) => <Score key={index} value={score.value} />);
};
`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });
  });

  describe("placeholder and memoized receivers (mined FP cluster)", () => {
    it("stays silent on Array.from({length}).fill('') placeholder chains", () => {
      const result = runRule(
        noArrayIndexAsKey,
        `const MockData = ({ text }) =>
  Array.from({ length: 50 })
    .fill("")
    .map((_, index) => <MockRow key={index}>{text}</MockRow>);
`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("stays silent on [...Array(computedCount)] skeleton placeholders", () => {
      const result = runRule(
        noArrayIndexAsKey,
        `const PendingRows = ({ total, current }) => (
  <ul>
    {[...Array(Math.min(total - current, 3))].map((_, i) => (
      <PendingSkeleton key={\`pending-\${i}\`} />
    ))}
  </ul>
);
`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("stays silent when the receiver is a useMemo list with empty deps", () => {
      const result = runRule(
        noArrayIndexAsKey,
        `const Particles = ({ count }) => {
  const particles = useMemo(() => buildParticles(count), []);
  return particles.map((particle, index) => <Particle key={index} particle={particle} />);
};
`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("stays silent when the receiver is a useMemo returning an array literal", () => {
      const result = runRule(
        noArrayIndexAsKey,
        `const MoreActions = ({ onDelete, canDelete }) => {
  const actions = useMemo(() => {
    return [{ label: "Delete", disabled: !canDelete, onClick: onDelete }];
  }, [canDelete, onDelete]);
  return actions.map((action, index) => <ActionButton key={index} action={action} />);
};
`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("still flags a useMemo receiver whose factory filters data with live deps", () => {
      const result = runRule(
        noArrayIndexAsKey,
        `const List = ({ items, query }) => {
  const visible = useMemo(() => items.filter((item) => item.name.includes(query)), [items, query]);
  return visible.map((item, index) => <Row key={index} item={item} />);
};
`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("stays silent on a composite key whose item read is wrapped in String()", () => {
      const result = runRule(
        noArrayIndexAsKey,
        `const Options = ({ options }) => (
  <div>
    {options.map((option, index) => (
      <Option key={\`\${String(option.value)}-\${index}\`} option={option} />
    ))}
  </div>
);
`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });
  });

  describe("index laundering the old detector missed (mined FN cluster)", () => {
    it("flags an iterator callback whose second parameter has a non-index name (cloudscape box-nesting)", () => {
      const result = runRule(
        noArrayIndexAsKey,
        `const Permutations = ({ colorPermutations }) => (
  <div>
    {colorPermutations.map((permutation, key) => (
      <PermutationBox key={key} {...permutation} />
    ))}
  </div>
);
`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].message).toContain('"key"');
    });

    it("flags a template key built from a descriptively named map index", () => {
      const result = runRule(
        noArrayIndexAsKey,
        `const Grid = ({ rows }) => (
  <table>
    <tbody>
      {rows.map((row, rowIndex) => (
        <GridRow key={\`r-\${rowIndex}\`} row={row} />
      ))}
    </tbody>
  </table>
);
`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("flags an index laundered through a local variable", () => {
      const result = runRule(
        noArrayIndexAsKey,
        `const Fields = ({ formFieldItems }) => (
  <div>
    {formFieldItems.map((field, index) => {
      const fieldKey = index;
      return <FormField key={fieldKey} field={field} />;
    })}
  </div>
);
`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("flags an index laundered through a template-literal variable", () => {
      const result = runRule(
        noArrayIndexAsKey,
        `const List = ({ items }) => (
  <ul>
    {items.map((item, i) => {
      const itemKey = \`item-\${i}\`;
      return <Row key={itemKey} item={item} />;
    })}
  </ul>
);
`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });
  });

  describe("index-keyed fragments wrapping stateful children (mined FN cluster)", () => {
    it("flags React.Fragment keyed by index when its children carry state (cloudscape performance marks)", () => {
      const result = runRule(
        noArrayIndexAsKey,
        `const Marks = ({ marks }) => (
  <dl>
    {marks.map((mark, index) => (
      <React.Fragment key={index}>
        <dt>{mark.label}</dt>
        <dd>
          <input value={mark.value} />
        </dd>
      </React.Fragment>
    ))}
  </dl>
);
`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("flags bare Fragment keyed by index around custom components", () => {
      const result = runRule(
        noArrayIndexAsKey,
        `const Links = ({ links }) => (
  <nav>
    {links.map((link, index) => (
      <Fragment key={index}>
        <NavLink href={link.href}>{link.label}</NavLink>
      </Fragment>
    ))}
  </nav>
);
`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("stays silent on an index-keyed fragment with only static text children", () => {
      const result = runRule(
        noArrayIndexAsKey,
        `const Dividers = ({ sections }) => (
  <div>
    {sections.map((section, index) => (
      <Fragment key={index}>
        <br />
      </Fragment>
    ))}
  </div>
);
`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });
  });

  describe("entries() tuples still resolve as positional indexes", () => {
    it("flags the first tuple element of a for-of over items.entries()", () => {
      const result = runRule(
        noArrayIndexAsKey,
        `const List = ({ items }) => {
  const out = [];
  for (const [index, item] of items.entries()) {
    out.push(<Row key={index} item={item} />);
  }
  return out;
};
`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("flags the first tuple element of a spread entries() map", () => {
      const result = runRule(
        noArrayIndexAsKey,
        `const List = ({ items }) => (
  <ul>
    {[...items.entries()].map(([index, item]) => (
      <Row key={index} item={item} />
    ))}
  </ul>
);
`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("stays silent on Object.entries tuples keyed by the property key", () => {
      const result = runRule(
        noArrayIndexAsKey,
        `const Table = ({ record }) => (
  <dl>
    {Object.entries(record).map(([key, value]) => (
      <Row key={key} value={value} />
    ))}
  </dl>
);
`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });
  });
});
