import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noNondeterministicIdValueInRenderBody } from "./no-nondeterministic-id-value-in-render-body.js";

describe("no-nondeterministic-id-value-in-render-body", () => {
  it("flags uniqueId bound in render body wired to htmlFor", () => {
    const result = runRule(
      noNondeterministicIdValueInRenderBody,
      `import { uniqueId } from "lodash";
      const Toggle = ({ label, onChange }) => {
        const id = uniqueId();
        return (<><label htmlFor={id}>{label}</label><input id={id} onChange={onChange} /></>);
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags crypto.randomUUID bound in render body wired to aria", () => {
    const result = runRule(
      noNondeterministicIdValueInRenderBody,
      `const TextInput = ({ error }) => {
        const describedById = crypto.randomUUID();
        return (<><input aria-describedby={describedById} /><span id={describedById}>{error}</span></>);
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags nanoid bound in render body used as an SVG clip-path reference", () => {
    const result = runRule(
      noNondeterministicIdValueInRenderBody,
      `import { nanoid } from "nanoid";
      const RadioInput = () => {
        const clipId = nanoid();
        return (<svg><clipPath id={clipId} /><rect clipPath={\`url(#\${clipId})\`} /></svg>);
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags the useMemo one-shot variant even without a JSX sink", () => {
    const result = runRule(
      noNondeterministicIdValueInRenderBody,
      `import { uniqueId } from "lodash";
      const useBundleChartData = () => {
        const chartId = useMemo(() => uniqueId(), []);
        return { chartId };
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet when the id is minted inside an event handler", () => {
    const result = runRule(
      noNondeterministicIdValueInRenderBody,
      `const TaskCommentInput = () => {
        const submit = () => {
          const commentId = crypto.randomUUID();
          addComment({ id: commentId });
        };
        return <button onClick={submit}>Send</button>;
      };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when the id is minted inside a provider callback", () => {
    const result = runRule(
      noNondeterministicIdValueInRenderBody,
      `import { nanoid } from "nanoid";
      const AlertProvider = ({ children }) => {
        const addAlert = (message) => {
          const id = nanoid();
          setAlerts((prev) => [...prev, { id, message }]);
        };
        return <AlertContext.Provider value={{ addAlert }}>{children}</AlertContext.Provider>;
      };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for a generated value used only for logging (no identity sink)", () => {
    const result = runRule(
      noNondeterministicIdValueInRenderBody,
      `const Demo = () => {
        const traceId = crypto.randomUUID();
        logger.debug('render', traceId);
        return <CodeDiff />;
      };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when the value is already wrapped in useState", () => {
    const result = runRule(
      noNondeterministicIdValueInRenderBody,
      `import { uniqueId } from "lodash";
      const VictoryPortal = () => {
        const [id] = useState(uniqueId());
        return <div id={id} />;
      };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for key usage (deferred to no-random-key)", () => {
    const result = runRule(
      noNondeterministicIdValueInRenderBody,
      `import { uniqueId } from "lodash";
      const List = ({ items }) => {
        const id = uniqueId();
        return <ul>{items.map((item) => <li key={id}>{item}</li>)}</ul>;
      };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when the generator name is a local shadow", () => {
    const result = runRule(
      noNondeterministicIdValueInRenderBody,
      `const uniqueId = () => "stable-id";
      const Toggle = () => {
        const id = uniqueId();
        return <input id={id} />;
      };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when shortid.generate is a local object method", () => {
    const result = runRule(
      noNondeterministicIdValueInRenderBody,
      `const shortid = { generate: () => "stable-id" };
      const Field = () => {
        const id = shortid.generate();
        return <label htmlFor={id}>Name</label>;
      };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet outside a component or hook body", () => {
    const result = runRule(
      noNondeterministicIdValueInRenderBody,
      `import { nanoid } from "nanoid";
      const makeThing = () => {
        const id = nanoid();
        return { id };
      };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for Date.now / Math.random (deferred to the time rule)", () => {
    const result = runRule(
      noNondeterministicIdValueInRenderBody,
      `const Widget = () => {
        const id = Date.now().toString();
        return <div id={id} />;
      };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when the sink reads a member property of the same name (todo.id list idiom)", () => {
    const result = runRule(
      noNondeterministicIdValueInRenderBody,
      `import { nanoid } from "nanoid";
      const TodoList = ({ todos, onDraft }) => {
        const id = nanoid();
        const startDraft = () => onDraft({ id });
        return (<ul onMouseDown={startDraft}>{todos.map((todo) => <li key={todo.id} id={\`todo-\${todo.id}\`}>{todo.text}</li>)}</ul>);
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when a map-callback destructured param shadows the generated id (htmlFor={id} field-list idiom)", () => {
    const result = runRule(
      noNondeterministicIdValueInRenderBody,
      `import { nanoid } from "nanoid";
      const Fields = ({ fields, onAdd }) => {
        const id = nanoid();
        const addField = () => onAdd({ id, value: "" });
        return (<div onFocus={addField}>{fields.map(({ id, label }) => <label key={id} htmlFor={id}>{label}</label>)}</div>);
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags the pre-useId fallback idiom `providedId || uniqueId()` wired to htmlFor", () => {
    const result = runRule(
      noNondeterministicIdValueInRenderBody,
      `import { uniqueId } from "lodash";
      const Toggle = ({ label, id: providedId }) => {
        const id = providedId || uniqueId();
        return (<><label htmlFor={id}>{label}</label><input id={id} /></>);
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a template-literal-prefixed generated id flowing into an SVG clipPath sink", () => {
    const result = runRule(
      noNondeterministicIdValueInRenderBody,
      `import { nanoid } from "nanoid";
      const Chart = () => {
        const clipId = \`clip-\${nanoid()}\`;
        return (<svg><clipPath id={clipId} /><rect clipPath={\`url(#\${clipId})\`} /></svg>);
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat useMemo with real deps as a one-shot", () => {
    const result = runRule(
      noNondeterministicIdValueInRenderBody,
      `import { uniqueId } from "lodash";
      const useThing = (seed) => {
        const chartId = useMemo(() => uniqueId(), [seed]);
        return { chartId };
      };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a useId-derived factory whose method is named uniqueId", () => {
    const result = runRule(
      noNondeterministicIdValueInRenderBody,
      `const useFieldIds = () => {
        const baseId = useId();
        return useMemo(() => ({ uniqueId: (fieldName) => baseId + "-" + fieldName }), [baseId]);
      };
      const SignupForm = () => {
        const fieldIds = useFieldIds();
        const emailFieldId = fieldIds.uniqueId("email");
        return (<><label htmlFor={emailFieldId}>Email</label><input id={emailFieldId} type="email" /></>);
      };`,
      { filename: "signup.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an id used only inside handler-serialized static markup", () => {
    const result = runRule(
      noNondeterministicIdValueInRenderBody,
      `import { nanoid } from "nanoid";
      import { renderToStaticMarkup } from "react-dom/server";
      const ChartExportButton = ({ points }) => {
        const exportGradientId = \`export-grad-\${nanoid()}\`;
        const handleDownload = () => {
          const svgMarkup = renderToStaticMarkup(
            <svg viewBox="0 0 100 40">
              <defs><linearGradient id={exportGradientId}><stop offset="0" stopColor="#09f" /></linearGradient></defs>
              <polyline fill={\`url(#\${exportGradientId})\`} points={points} />
            </svg>,
          );
          download(svgMarkup);
        };
        return <button onClick={handleDownload}>Export</button>;
      };`,
      { filename: "chart-export.tsx" },
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a props-injected registry uniqueId method", () => {
    const result = runRule(
      noNondeterministicIdValueInRenderBody,
      `const OutlineItem = ({ node, idRegistry }) => {
        const anchorId = idRegistry.uniqueId(node.key);
        return <a id={anchorId} href={"#" + anchorId}>{node.title}</a>;
      };`,
      { filename: "outline.tsx" },
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});

describe("audit regressions", () => {
  it("flags nanoid called through a namespace import", () => {
    const result = runRule(
      noNondeterministicIdValueInRenderBody,
      `import * as ids from "nanoid"; const Field = () => { const id = ids.nanoid(); return <><label htmlFor={id}>Name</label><input id={id} /></>; };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not confuse a nested shadow with the nanoid namespace import", () => {
    const result = runRule(
      noNondeterministicIdValueInRenderBody,
      `import * as ids from "nanoid"; const Field = () => { const ids = { nanoid: () => "fixed" }; const id = ids.nanoid(); return <input id={id} />; };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags an aliased named nanoid import", () => {
    const result = runRule(
      noNondeterministicIdValueInRenderBody,
      `import { nanoid as makeId } from "nanoid"; const Field = () => { const id = makeId(); return <input id={id} />; };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat aria-label as an ID reference", () => {
    const result = runRule(
      noNondeterministicIdValueInRenderBody,
      `import { nanoid } from "nanoid"; const C = () => { const label = nanoid(); return <button aria-label={label} />; };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("requires an exact generator import source", () => {
    const result = runRule(
      noNondeterministicIdValueInRenderBody,
      `import { nanoid } from "./deterministic"; const C = () => { const id = nanoid(); return <div id={id} />; };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("follows direct aliases into identity sinks", () => {
    const result = runRule(
      noNondeterministicIdValueInRenderBody,
      `import { nanoid } from "nanoid"; const C = () => { const raw = nanoid(); const id = raw; return <div id={id} />; };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an inline generator in an identity sink", () => {
    const result = runRule(
      noNondeterministicIdValueInRenderBody,
      `import { nanoid } from "nanoid"; const C = () => <div id={nanoid()} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat a shadowed useMemo helper as React", () => {
    const result = runRule(
      noNondeterministicIdValueInRenderBody,
      `import { nanoid } from "nanoid";
      const useMemo = () => "fixed";
      const C = () => { const id = useMemo(() => nanoid(), []); return <div>{id}</div>; };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("supports aliased React useMemo and static computed generators", () => {
    const memoResult = runRule(
      noNondeterministicIdValueInRenderBody,
      `import { useMemo as memo } from "react"; import { nanoid } from "nanoid";
      const C = () => { const id = memo(() => nanoid(), []); return <label id={id} />; };`,
    );
    const computedResult = runRule(
      noNondeterministicIdValueInRenderBody,
      `const C = () => <label id={crypto["randomUUID"]()} />;`,
    );
    expect(memoResult.diagnostics).toHaveLength(1);
    expect(computedResult.diagnostics).toHaveLength(1);
  });
});
