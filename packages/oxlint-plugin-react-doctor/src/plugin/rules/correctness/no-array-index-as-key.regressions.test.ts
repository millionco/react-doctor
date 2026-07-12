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

  describe("array literal receivers — rows carry identity, so plain literals fire (fn-hunt sweep)", () => {
    it("flags a module const array of object literals mapped with an index key", () => {
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
      expect(result.diagnostics).toHaveLength(1);
    });

    it("flags an inline array literal receiver with stateful children", () => {
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
      expect(result.diagnostics).toHaveLength(1);
    });

    it("stays silent when the receiver is a destructured prop DEFAULT of a static literal (tracecat locked-feature)", () => {
      const result = runRule(
        noArrayIndexAsKey,
        `const LOCKED_FEATURE_BULLETS = [
  "Get production-ready automations.",
  "Author, version, and publish skills.",
];
const LockedFeatureModal = ({ bullets = LOCKED_FEATURE_BULLETS }) => (
  <ul>
    {bullets.map((bullet, index) => (
      <li key={\`bullet-\${index}\`}>{bullet}</li>
    ))}
  </ul>
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

    it("flags a composite key whose same-map item read is wrapped in String() (fn-hunt sweep)", () => {
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
      expect(result.diagnostics).toHaveLength(1);
    });
  });

  describe("index laundering the old detector missed (mined FN cluster)", () => {
    // Per the official prompt, only indexes named i / idx / index fire —
    // `key`, `rowIndex`, `ti`, `j` are outside the documented name set.
    it("stays silent on an iterator callback whose second parameter has a non-index name (cloudscape box-nesting)", () => {
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
      expect(result.diagnostics).toEqual([]);
    });

    it("stays silent on a template key built from a descriptively named map index", () => {
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
      expect(result.diagnostics).toEqual([]);
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

    // fn-mining sweep: an arithmetic offset keeps the key index-derived.
    it("flags an index offset by a numeric literal", () => {
      const result = runRule(
        noArrayIndexAsKey,
        `const List = ({ items }) => (
  <ul>
    {items.map((item, index) => (
      <Row key={index + 1} data={item} />
    ))}
  </ul>
);
`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    // fn-mining sweep: unary negation is still an injective function of
    // the position.
    it("flags an index negated by a unary expression", () => {
      const result = runRule(
        noArrayIndexAsKey,
        `const List = ({ items }) => (
  <ul>
    {items.map((item, index) => (
      <Row key={-index} data={item} />
    ))}
  </ul>
);
`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("stays silent on an arithmetic key whose identifier is not a positional index", () => {
      const result = runRule(
        noArrayIndexAsKey,
        `const Pager = ({ page, items }) => (
  <ul>
    {items.map((item) => (
      <Row key={page + 1} data={item} />
    ))}
  </ul>
);
`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
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

  describe("docs-validation FP sweep (2026-07)", () => {
    // frimousse emoji-picker sizer: index-keyed rows inside an aria-hidden,
    // height-0 measurement container are invisible — no user-facing hazard.
    it("stays silent inside an aria-hidden sizer container", () => {
      const result = runRule(
        noArrayIndexAsKey,
        `const RowSizer = ({ emojis }) => (
  <div aria-hidden style={{ height: 0, visibility: "hidden" }}>
    <div>
      {emojis.map((emoji, index) => (
        <Emoji key={index} emoji={emoji} />
      ))}
    </div>
  </div>
);
`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("still flags an index key when aria-hidden is dynamic", () => {
      const result = runRule(
        noArrayIndexAsKey,
        `const List = ({ emojis, hidden }) => (
  <div aria-hidden={hidden}>
    {emojis.map((emoji, index) => (
      <Emoji key={index} emoji={emoji} />
    ))}
  </div>
);
`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    // react-pro-sidebar CodePanel: syntax-highlight tokens rendered through
    // a named callback — inline text runs whose content is the item itself.
    it("stays silent on inline token spans rendered via a named map callback", () => {
      const result = runRule(
        noArrayIndexAsKey,
        `const renderToken = (token, i) => {
  if (token.type === "text") return token.text;
  return (
    <span key={i} className={\`t-\${token.type}\`}>
      {token.text}
    </span>
  );
};
const CodePanel = ({ tokens }) => (
  <pre>
    <code>{tokens.map(renderToken)}</code>
  </pre>
);
`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    // gatsby code-frame: ANSI-decoded fragments as index-keyed spans.
    it("stays silent on inline text-run spans reading only the item", () => {
      const result = runRule(
        noArrayIndexAsKey,
        `const CodeFrame = ({ decoded }) => (
  <pre>
    <code>
      {decoded.map((entry, index) => (
        <span key={\`frame-\${index}\`} style={{ color: entry.fg }}>
          {entry.content}
        </span>
      ))}
    </code>
  </pre>
);
`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("still flags an index-keyed li row reading the item", () => {
      const result = runRule(
        noArrayIndexAsKey,
        `const List = ({ items }) => (
  <ul>
    {items.map((item, index) => (
      <li key={index}>{item.name}</li>
    ))}
  </ul>
);
`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    // softmaple EditorSurface: compound key mixing the OUTER map's item
    // identity with the inner index — the outer item is the real identity.
    it("stays silent on a compound key using the enclosing map's item identity", () => {
      const result = runRule(
        noArrayIndexAsKey,
        `const PresenceLayer = ({ peers, text }) => (
  <div>
    {peers.map((peer) =>
      peer.rects.map((rect, i) => (
        <SelectionHighlight key={\`sel-\${peer.userId}-\${i}\`} rect={rect} />
      )),
    )}
  </div>
);
`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("still flags a template key whose only expression is the index", () => {
      const result = runRule(
        noArrayIndexAsKey,
        `const List = ({ rows }) => (
  <div>
    {rows.map((row, i) => (
      <Row key={\`row-\${i}\`} row={row} />
    ))}
  </div>
);
`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });
  });

  describe("fn-hunt corpus misses (2026-07) — must fire", () => {
    it("stays silent on stateless primitive display rows with duplicate-disambiguating keys", () => {
      const result = runRule(
        noArrayIndexAsKey,
        `const LicenseFeatures = ({ features }) => (
  <ul>
    {features.map((feature, index) => (
      <li key={\`\${feature}-\${index}\`}>{feature}</li>
    ))}
  </ul>
);
`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("still flags duplicate-disambiguating keys on editable rows", () => {
      const result = runRule(
        noArrayIndexAsKey,
        `const EditableFeatures = ({ features, setFeature, removeFeature }) => (
  <ul>
    {features.map((feature, index) => (
      <li key={\`\${feature}-\${index}\`}>
        <input value={feature} onChange={(event) => setFeature(index, event.target.value)} />
        <button onClick={() => removeFeature(index)}>Remove</button>
      </li>
    ))}
  </ul>
);
`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("still flags opaque destructured siblings not represented in the key", () => {
      const result = runRule(
        noArrayIndexAsKey,
        `const Rows = ({ rows }) => (
  <ul>
    {rows.map(({ label, content }, index) => (
      <li key={\`\${label}-\${index}\`}>{content}</li>
    ))}
  </ul>
);
`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("still flags primitive rows with DOM-managed stateful attributes", () => {
      const result = runRule(
        noArrayIndexAsKey,
        `const EditableLabels = ({ labels }) => (
  <ul>
    {labels.map((label, index) => (
      <li contentEditable key={\`\${label}-\${index}\`}>{label}</li>
    ))}
  </ul>
);
`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("stays silent when enumerated stateful attributes are statically false", () => {
      const result = runRule(
        noArrayIndexAsKey,
        `const Labels = ({ labels }) => (
  <ul>
    {labels.map((label, index) => (
      <li contentEditable={false} draggable="false" key={\`\${label}-\${index}\`}>{label}</li>
    ))}
  </ul>
);
`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    // glific InteractiveOptions: the map index is forwarded one hop into a
    // render helper whose FIRST parameter is the index.
    it("flags an index forwarded into a render helper's position-0 parameter", () => {
      const result = runRule(
        noArrayIndexAsKey,
        `const Options = ({ values, arrayHelpers }) => {
  const getButtons = (index, helpers) => (
    <ReplyTemplate key={index} index={index} onRemove={() => helpers.remove(index)} />
  );
  return <div>{values.templateButtons.map((row, index) => getButtons(index, arrayHelpers))}</div>;
};
`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    // Lumina-Note ChatPanel: <img> keyed by index — media elements carry
    // load state, so the stateless-leaf exemption must not apply.
    it("flags an index-keyed img element", () => {
      const result = runRule(
        noArrayIndexAsKey,
        `const renderMessageContent = (content) =>
  content.map((part, i) => {
    if (part.type === "text") return <span key={i}>{part.text}</span>;
    if (part.type === "image") return <img key={i} src={part.source} alt="attached" />;
    return null;
  });
`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    // Lumina-Note RightPanel: composite of the SAME map's item field plus
    // the index — appending the index still remints every key on reorder.
    it("flags a same-item composite key on an interactive row", () => {
      const result = runRule(
        noArrayIndexAsKey,
        `const Backlinks = ({ backlinks, openFile }) => (
  <div>
    {backlinks.map((backlink, idx) => (
      <button key={\`\${backlink.path}-\${idx}\`} onClick={() => openFile(backlink.path)}>
        {backlink.name}
      </button>
    ))}
  </div>
);
`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("flags a same-item composite key on a sliced dynamic list (lumina deep-research)", () => {
      const result = runRule(
        noArrayIndexAsKey,
        `const Results = ({ results }) => (
  <ul>
    {results.slice(0, 10).map((result, i) => (
      <motion.li key={\`\${result.url}-\${i}\`}>{result.title}</motion.li>
    ))}
  </ul>
);
`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    // audius EnterPassword: a plain array literal is NOT the Array.from /
    // new Array placeholder shape — its rows have identity (labels).
    it("flags a template index key over a local array literal of data rows", () => {
      const result = runRule(
        noArrayIndexAsKey,
        `const EnterPassword = ({ requirements, messages }) => {
  const pwdChecks = [
    { status: requirements.number, label: messages.number },
    { status: requirements.length, label: messages.length },
  ];
  return (
    <div>
      {pwdChecks.map((check, i) => (
        <StatusMessage key={\`Check_\${i}\`} status={check.status} label={check.label} />
      ))}
    </div>
  );
};
`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    // PortOS UpcomingTasksWidget: composite of a NON-unique item field plus
    // the index over a variably sliced list.
    it("flags a non-identity composite key over a sliced task list", () => {
      const result = runRule(
        noArrayIndexAsKey,
        `const Widget = ({ readyTasks, getTaskIcon }) => (
  <div>
    {readyTasks.slice(0, 3).map((task, index) => (
      <div key={\`\${task.taskType}-ready-\${index}\`}>
        <span aria-hidden="true">{getTaskIcon(task.taskType)}</span>
        <span>{task.description}</span>
      </div>
    ))}
  </div>
);
`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    // tracecat codemirror tooltip: local string-literal list whose rows'
    // identity is the string itself.
    it("flags an index key over a local string-literal list rendered as rows", () => {
      const result = runRule(
        noArrayIndexAsKey,
        `const ActionTooltip = ({ action }) => {
  const commonProps = ["result", "error", "status"];
  return (
    <div>
      {commonProps.map((prop, index) => (
        <div key={index} className="action-prop">
          <strong>{prop}</strong>: Access {prop} from this action
        </div>
      ))}
    </div>
  );
};
`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    // tracecat validation-errors: .split() output is a data list, not the
    // excluded placeholder shape.
    it("flags an index-keyed fragment over optionally-chained split lines", () => {
      const result = runRule(
        noArrayIndexAsKey,
        `const ValidationErrorMessage = ({ error }) => {
  const formattedMessage = error.msg?.split("\\n").map((line, index) => (
    <React.Fragment key={index}>
      {line}
      <br />
    </React.Fragment>
  ));
  return <pre>{formattedMessage}</pre>;
};
`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    // semiotic MarginalGraphics: SVG rects over d3 bins where the callback
    // FILTERS rows (return null) — position is not stable, so the pure-SVG
    // exemption must not apply.
    it("flags index-keyed SVG rects when the callback filters rows out", () => {
      const result = runRule(
        noArrayIndexAsKey,
        `const Histogram = ({ bins, scale, config }) => (
  <g>
    {bins.map((bin, i) => {
      if (bin.x0 == null || bin.x1 == null) return null;
      return <rect key={i} x={scale(bin.x0)} width={scale(bin.x1) - scale(bin.x0)} fill={config.fill} />;
    })}
  </g>
);
`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    // bulwarkmail email-composer: composite of the bare item plus index over
    // user-mutable, drag-reorderable chips.
    it("flags a bare-item composite key on editable chips", () => {
      const result = runRule(
        noArrayIndexAsKey,
        `const Chips = ({ chips, onRemove }) => (
  <div>
    {chips.map((chip, i) => (
      <span key={\`\${chip}-\${i}\`} draggable>
        {chip}
        <button onClick={() => onRemove(i)}>x</button>
      </span>
    ))}
  </div>
);
`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("flags a multi-field composite key that still ends in the index (hyperdx pills)", () => {
      const result = runRule(
        noArrayIndexAsKey,
        `const Pills = ({ visiblePills, handleRemove }) => (
  <div>
    {visiblePills.map((pill, i) => (
      <FilterPill key={\`\${pill.field}-\${pill.type}-\${pill.value}-\${i}\`} pill={pill} onRemove={() => handleRemove(pill)} />
    ))}
  </div>
);
`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    // hyperdx WebhookForm: module-scope const literal of template-variable
    // strings — rows have identity, plain literals are not exempt.
    it("flags an index key over a module-scope string-literal list", () => {
      const result = runRule(
        noArrayIndexAsKey,
        `const DEFAULT_BODY = ["__HDX_ALERT_TITLE__", "__HDX_ALERT_BODY__", "__HDX_LINK__"];
const Hint = () => (
  <span>
    {DEFAULT_BODY.map((body, index) => (
      <span key={index}>
        <code>{body}</code>
        {index < DEFAULT_BODY.length - 1 && ", "}
      </span>
    ))}
  </span>
);
`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    // hyperdx KeyboardShortcutsModal: composite mixing an outer descriptive
    // index, the inner index, and the bare inner item — no stable identity.
    it("flags a composite key of outer index, inner index, and bare item", () => {
      const result = runRule(
        noArrayIndexAsKey,
        `const Shortcuts = ({ SHORTCUTS }) => (
  <div>
    {SHORTCUTS.map(({ keys, label }, rowIndex) => (
      <React.Fragment key={rowIndex}>
        {keys.map((key, i) => (
          <React.Fragment key={\`\${rowIndex}-\${i}-\${key}\`}>
            <Kbd size="xs">{key}</Kbd>
          </React.Fragment>
        ))}
        <span>{label}</span>
      </React.Fragment>
    ))}
  </div>
);
`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics.length).toBeGreaterThanOrEqual(1);
    });

    it("flags a same-item composite key on removable participant chips", () => {
      const result = runRule(
        noArrayIndexAsKey,
        `const Participants = ({ participants, onRemove }) => (
  <div>
    {participants.map((p, i) => (
      <span key={\`\${p.email}-\${i}\`}>
        <button onClick={() => onRemove(p.email)}>{p.name || p.email}</button>
      </span>
    ))}
  </div>
);
`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("flags an index-prefixed composite key on navigation breadcrumbs", () => {
      const result = runRule(
        noArrayIndexAsKey,
        `const Breadcrumbs = ({ breadcrumbs, onNavigate }) => (
  <nav>
    {breadcrumbs.map((crumb, i) => (
      <span key={\`\${i}:\${crumb.path}\`}>
        <button onClick={() => onNavigate(crumb.path)}>{crumb.name}</button>
      </span>
    ))}
  </nav>
);
`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("flags an index key over split() keyboard-shortcut fragments with a bare item child", () => {
      const result = runRule(
        noArrayIndexAsKey,
        `const ShortcutKeys = ({ shortcutKey }) => {
  const keys = shortcutKey.split(" / ");
  return (
    <div>
      {keys.map((key, index) => (
        <span key={index}>
          {index > 0 && <span>or</span>}
          <kbd>{key}</kbd>
        </span>
      ))}
    </div>
  );
};
`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });
  });

  describe("delta-results corpus FPs (2026-07) — must stay silent", () => {
    // nexu-io UseEverywhereModal: laundered composite of a stable container
    // id plus the inner index over static documentation snippets.
    it("stays silent on a laundered composite key of a stable .id plus index", () => {
      const result = runRule(
        noArrayIndexAsKey,
        `const SectionView = ({ section, snippetCopy, onCopySnippet }) => (
  <div>
    {section.snippets.map((snippet, idx) => {
      const key = \`\${section.id}-\${idx}\`;
      return (
        <div key={key}>
          <span>{snippet.label}</span>
          <button onClick={() => onCopySnippet(key, snippet)}>copy</button>
        </div>
      );
    })}
  </div>
);
`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    // semiotic renderToStaticSVG: a list of renderer FUNCTIONS invoked as
    // the row content — the item is callable, position is its identity.
    it("stays silent on index-keyed fragments whose content is the invoked item", () => {
      const result = runRule(
        noArrayIndexAsKey,
        `const PreRenderers = ({ renderers, scene, scales }) => (
  <g>
    {renderers
      .map((fn, i) => {
        try {
          return <React.Fragment key={\`pre-\${i}\`}>{fn(scene, scales)}</React.Fragment>;
        } catch {
          return null;
        }
      })
      .filter(Boolean)}
  </g>
);
`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    // Lumina-Note AgentMessageRenderer: descriptive index name outside the
    // documented i/idx/index set.
    it("stays silent on a laundered composite key with a descriptive index name", () => {
      const result = runRule(
        noArrayIndexAsKey,
        `const Round = ({ round, t }) =>
  round.parts.map((part, partIndex) => {
    const key = \`\${round.roundKey}-part-\${partIndex}\`;
    if (part.type === "thinking") return <ThinkingCollapsible key={key} thinking={part.content} t={t} />;
    return <ToolCallCollapsible key={key} tool={part.tool} t={t} />;
  });
`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    // Per the official prompt, only iteration indexes NAMED i / idx / index
    // fire — `key`, `ti`, `j`, `itemIndex` do not.
    it("stays silent on an iterator second parameter named `key` (cloudscape demo pages)", () => {
      const result = runRule(
        noArrayIndexAsKey,
        `const IconOptions = ({ icons }) => (
  <select>
    {Object.keys(icons).map((icon, key) => (
      <option value={icon} key={key}>{icon}</option>
    ))}
  </select>
);
`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("stays silent on an iterator second parameter named `ti` (PortOS checklist)", () => {
      const result = runRule(
        noArrayIndexAsKey,
        `const PhaseCard = ({ plan }) => (
  <div>
    {plan.tasks.map((task, ti) => (
      <div key={ti}>
        <span>{task.completed ? "done" : "todo"}</span>
        <span>{task.text}</span>
      </div>
    ))}
  </div>
);
`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("stays silent on nested iterators indexed by `j` (psysonic word spans)", () => {
      const result = runRule(
        noArrayIndexAsKey,
        `const Traits = ({ newDimensions }) => (
  <div>
    {newDimensions.map((dim, i) => (
      <div key={i}>
        <div>{dim.name}</div>
        {dim.traits.map((t, j) => (
          <div key={j}>
            <span>{t.trait}:</span> {t.expression}
          </div>
        ))}
      </div>
    ))}
  </div>
);
`,
      );
      expect(result.parseErrors).toEqual([]);
      // Only the outer `i` key may fire; the inner `j` key must not.
      expect(result.diagnostics).toHaveLength(1);
    });

    it("stays silent on an iterator second parameter named `itemIndex` (cloudscape key-value pairs)", () => {
      const result = runRule(
        noArrayIndexAsKey,
        `const Group = ({ pair }) => (
  <dl>
    {pair.items.map((item, itemIndex) => (
      <div key={itemIndex}>
        <InternalKeyValuePair {...item} />
      </div>
    ))}
  </dl>
);
`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    // dtale ViewRow: fragment rows whose content is member reads of the
    // item (including computed reads keyed BY the item) — pure display.
    it("stays silent on index-keyed fragments of item-derived display text", () => {
      const result = runRule(
        noArrayIndexAsKey,
        `const ViewRow = ({ displayCols, row }) => (
  <div>
    {displayCols.map((colCfg, idx) => (
      <React.Fragment key={idx}>
        <div>
          <b>{\`\${colCfg.name}:\`}</b>
          <div>{row[colCfg.name].view}</div>
        </div>
      </React.Fragment>
    ))}
  </div>
);
`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    // rozenite KeyValueGrid: fragment wrapping display-only spans reading
    // item fields.
    it("stays silent on index-keyed fragments of item member-read spans", () => {
      const result = runRule(
        noArrayIndexAsKey,
        `const KeyValueGrid = ({ items }) => (
  <div>
    {items.map((item, index) => (
      <Fragment key={index}>
        <span>{item.key}</span>
        <span>{item.value}</span>
      </Fragment>
    ))}
  </div>
);
`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    // devlovers BlogPostRenderer: recursive AST renderer keying stateless
    // block elements whose children derive from the item node.
    it("stays silent on a laundered index key whose children derive from the item", () => {
      const result = runRule(
        noArrayIndexAsKey,
        `const renderNode = (node, index) => {
  const children = node.content?.map((child, i) => renderNode(child, i));
  const key = \`node-\${index}\`;
  switch (node.type) {
    case "blockquote":
      return <blockquote key={key}>{children}</blockquote>;
    case "bulletList":
      return <ul key={key}>{children}</ul>;
    default:
      return null;
  }
};
`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });
  });
});
