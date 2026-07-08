import { PATHOLOGICAL_PROGRAM_PROBABILITY } from "./constants.js";
import { generatePathologicalProgram } from "./generate-pathological-program.js";
import type { SeededRandom } from "./seeded-random.js";
import {
  A11Y_TRIGGER_ATTRIBUTE_POOL,
  EDGE_CASE_STATEMENT_POOL,
  EFFECT_SNIPPET_POOL,
  GUARD_SNIPPET_POOL,
  HANDLER_SNIPPET_POOL,
  IMPORT_LINE_POOL,
  JSX_ATTRIBUTE_POOL,
  JSX_LEAF_POOL,
  LIBRARY_SNIPPET_POOL,
  MODULE_SCOPE_SNIPPET_POOL,
  STATE_SNIPPET_POOL,
  TRIGGER_IDENTIFIER_POOL,
} from "./snippet-pools.js";

type SnippetBuilder = (random: SeededRandom) => string;

export interface GeneratedFuzzProgram {
  code: string;
  // Top-level sections (import block, module statements, components) —
  // metamorphic variants splice comments/whitespace BETWEEN sections, which
  // is always syntax- and semantics-preserving, unlike splicing into
  // arbitrary line positions (template literals and JSX text span lines).
  sections: string[];
}

const HTML_TAG_POOL = [
  "div",
  "span",
  "a",
  "img",
  "button",
  "input",
  "p",
  "table",
  "tr",
  "td",
  "ul",
  "li",
  "form",
  "label",
  "select",
  "iframe",
  "video",
  "marquee",
  "dialog",
] as const;

const buildImportBlock: SnippetBuilder = (random) => {
  const importCount = random.intBetween(2, 6);
  const chosen = new Set<string>();
  for (let index = 0; index < importCount; index += 1) chosen.add(random.pick(IMPORT_LINE_POOL));
  return [...chosen].join("\n");
};

const buildJsxTree = (random: SeededRandom, depth: number): string => {
  if (depth <= 0) return random.pick(JSX_LEAF_POOL);
  const tag = random.pick(HTML_TAG_POOL);
  const attributeCount = random.int(3);
  const attributes: string[] = [];
  for (let index = 0; index < attributeCount; index += 1) {
    attributes.push(
      random.chance(0.2)
        ? random.pick(A11Y_TRIGGER_ATTRIBUTE_POOL)
        : random.pick(JSX_ATTRIBUTE_POOL),
    );
  }
  const attributeText = attributes.length > 0 ? ` ${attributes.join(" ")}` : "";
  if (random.chance(0.2)) return `<${tag}${attributeText} />`;
  const childCount = random.intBetween(1, 3);
  const children: string[] = [];
  for (let index = 0; index < childCount; index += 1) {
    children.push(buildJsxTree(random, depth - 1));
  }
  return `<${tag}${attributeText}>${children.join("")}</${tag}>`;
};

// Scenario builders emit MULTI-statement sequences whose statements share
// bindings (alias → guard → deref, register → cleanup, flag → async write).
// Rules with relationship-sensitive exemptions (alias guards, copy-before-
// mutate, cleanup pairing, cancellation flags) only leave their early bails
// when these relationships exist — independent statement sampling almost
// never forms them.
const SCENARIO_POOL: ReadonlyArray<SnippetBuilder> = [
  (random) =>
    [
      `const price = config?.price;`,
      random.chance(0.5) ? `if (!price) return null;` : `if (price == null) return null;`,
      `const total = config?.price * ${random.intBetween(2, 9)};`,
      `const formatted = total.toFixed(2);`,
    ].join("\n  "),
  (random) =>
    [
      random.chance(0.5) ? `const draft = [...items];` : `const draft = items.slice();`,
      `draft.sort();`,
      `setSelected(draft);`,
    ].join("\n  "),
  () =>
    [
      `const savingRef = useRef(false);`,
      `const handleGuardedSave = async () => {`,
      `  if (savingRef.current) return;`,
      `  savingRef.current = true;`,
      `  await api.post(url, values);`,
      `  setState(true);`,
      `  savingRef.current = false;`,
      `};`,
    ].join("\n  "),
  (random) => {
    const usesCancellation = random.chance(0.6);
    return [
      `useEffect(() => {`,
      usesCancellation ? `  let cancelled = false;` : ``,
      `  (async () => {`,
      `    const response = await fetch(url);`,
      `    const payload = await response.json();`,
      usesCancellation ? `    if (!cancelled) setState(payload);` : `    setState(payload);`,
      `  })();`,
      usesCancellation ? `  return () => { cancelled = true; };` : ``,
      `}, [url]);`,
    ]
      .filter((line) => line.length > 0)
      .join("\n  ");
  },
  (random) => {
    const removesSameHandler = random.chance(0.6);
    return [
      `useEffect(() => {`,
      `  const onScroll = () => handle(window.scrollY);`,
      `  window.addEventListener("scroll", onScroll);`,
      removesSameHandler
        ? `  return () => window.removeEventListener("scroll", onScroll);`
        : `  return () => window.removeEventListener("scroll", () => handle(window.scrollY));`,
      `}, []);`,
    ].join("\n  ");
  },
  (random) =>
    [
      `const response = await fetch(url);`,
      random.chance(0.5) ? `if (!response.ok) throw new Error("failed");` : ``,
      `const payload = await response.json();`,
      `setState(payload);`,
    ]
      .filter((line) => line.length > 0)
      .join("\n    ")
      .replace(/^/, `const load = async () => {\n    `)
      .concat(`\n  };`),
];

const buildComponent: SnippetBuilder = (random) => {
  const componentName = `Fuzz${random.pick(["Panel", "Card", "List", "Widget", "Overlay"])}${random.int(100)}`;
  const bodyStatements: string[] = [];
  const stateCount = random.intBetween(1, 3);
  for (let index = 0; index < stateCount; index += 1) {
    bodyStatements.push(random.pick(STATE_SNIPPET_POOL));
  }
  const effectCount = random.int(3);
  for (let index = 0; index < effectCount; index += 1) {
    bodyStatements.push(random.pick(EFFECT_SNIPPET_POOL));
  }
  const handlerCount = random.int(3);
  for (let index = 0; index < handlerCount; index += 1) {
    bodyStatements.push(random.pick(HANDLER_SNIPPET_POOL));
  }
  const guardCount = random.int(3);
  for (let index = 0; index < guardCount; index += 1) {
    bodyStatements.push(random.pick(GUARD_SNIPPET_POOL));
  }
  if (random.chance(0.35)) bodyStatements.push(random.pick(LIBRARY_SNIPPET_POOL));
  if (random.chance(0.4)) bodyStatements.push(random.pick(SCENARIO_POOL)(random));
  if (random.chance(0.25)) bodyStatements.push(random.pick(EDGE_CASE_STATEMENT_POOL));
  if (random.chance(0.3)) {
    const gateName = random.pick(TRIGGER_IDENTIFIER_POOL);
    bodyStatements.push(`if (!${gateName}) return null;`);
  }
  const jsx = buildJsxTree(random, random.intBetween(1, 4));
  const propsPattern = random.pick([
    `()`,
    `({ items, value, onSelect })`,
    `(props)`,
    `({ items = [], ...restProps })`,
    `({ value, isChecked, isOpen: isOpenProp, config, params, blob, condition, label, altText, url, variant, index, dynamicRole, key })`,
  ]);
  const wrapperName = random.chance(0.2) ? random.pick(["memo", "observer", "forwardRef"]) : null;
  const exportPrefix = random.chance(0.5) ? "export " : "";
  const openLine = wrapperName
    ? `${exportPrefix}const ${componentName} = ${wrapperName}(${propsPattern} => {`
    : `${exportPrefix}const ${componentName} = ${propsPattern} => {`;
  const closeLine = wrapperName ? `});` : `};`;
  return [
    openLine,
    ...bodyStatements.map((statement) => `  ${statement}`),
    `  return (${jsx});`,
    closeLine,
  ].join("\n");
};

const buildClassComponent: SnippetBuilder = (random) => {
  const componentName = `FuzzLegacy${random.int(100)}`;
  const hasWillUnmount = random.chance(0.6);
  const usesRefNode = random.chance(0.4);
  const mountTarget = usesRefNode ? "this.containerRef.current" : "window";
  return [
    `export class ${componentName} extends React.Component {`,
    `  containerRef = React.createRef();`,
    `  handleScroll = () => { this.setState({ top: window.scrollY }); };`,
    `  componentDidMount() {`,
    `    ${mountTarget}.addEventListener("scroll", this.handleScroll);`,
    random.chance(0.4) ? `    this.timer = setInterval(() => this.forceUpdate(), 1000);` : ``,
    `  }`,
    hasWillUnmount
      ? [
          `  componentWillUnmount() {`,
          `    ${mountTarget}.removeEventListener("scroll", this.handleScroll);`,
          `  }`,
        ].join("\n")
      : ``,
    `  render() {`,
    `    return <div ref={this.containerRef}>{this.props.children}</div>;`,
    `  }`,
    `}`,
  ]
    .filter((line) => line.length > 0)
    .join("\n");
};

const buildCustomHook: SnippetBuilder = (random) => {
  const hookName = `useFuzz${random.pick(["Data", "Toggle", "Tracker"])}${random.int(100)}`;
  const body = random.pick([
    `const [state, setState] = useState(false);\n  useEffect(() => { setState(true); }, []);\n  return state;`,
    `const stored = useRef(initial);\n  return stored.current;`,
    `if (!globalThis.flag) return null;\n  return useContext(ThemeContext);`,
    `const [state, setState] = useState(initial);\n  const toggle = useCallback(() => setState((prev) => !prev), []);\n  return [state, toggle] as const;`,
    `const [state, setState] = useState(() => (typeof window === "undefined" ? initial : window.matchMedia("(max-width: 768px)").matches));\n  useEffect(() => { const onChange = () => setState(window.innerWidth < 768); window.addEventListener("resize", onChange); return () => window.removeEventListener("resize", onChange); }, []);\n  return state;`,
    `const stored = useRef(initial);\n  useEffect(() => { stored.current = initial; });\n  return useCallback(() => stored.current, []);`,
  ]);
  return `const ${hookName} = (initial) => {\n  ${body}\n};`;
};

const buildModuleNoise: SnippetBuilder = (random) =>
  random.chance(0.15)
    ? random.pick(EDGE_CASE_STATEMENT_POOL)
    : random.pick(MODULE_SCOPE_SNIPPET_POOL);

export const generateStructuredFuzzProgram = (random: SeededRandom): GeneratedFuzzProgram => {
  if (random.chance(PATHOLOGICAL_PROGRAM_PROBABILITY)) {
    const code = generatePathologicalProgram(random);
    return { code, sections: [code] };
  }
  const sections: string[] = [buildImportBlock(random)];
  const moduleNoiseCount = random.int(3);
  for (let index = 0; index < moduleNoiseCount; index += 1) {
    sections.push(buildModuleNoise(random));
  }
  if (random.chance(0.4)) sections.push(buildCustomHook(random));
  if (random.chance(0.2)) sections.push(buildClassComponent(random));
  const componentCount = random.intBetween(1, 3);
  for (let index = 0; index < componentCount; index += 1) {
    sections.push(buildComponent(random));
  }
  return { code: `${sections.join("\n\n")}\n`, sections };
};

export const generateFuzzProgram = (random: SeededRandom): string =>
  generateStructuredFuzzProgram(random).code;
