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
      };`
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
      };`
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
      };`
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
      };`
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
      };`
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
      };`
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
      };`
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
      };`
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
      };`
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
      };`
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
      };`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for Date.now / Math.random (deferred to the time rule)", () => {
    const result = runRule(
      noNondeterministicIdValueInRenderBody,
      `const Widget = () => {
        const id = Date.now().toString();
        return <div id={id} />;
      };`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not treat useMemo with real deps as a one-shot", () => {
    const result = runRule(
      noNondeterministicIdValueInRenderBody,
      `import { uniqueId } from "lodash";
      const useThing = (seed) => {
        const chartId = useMemo(() => uniqueId(), [seed]);
        return { chartId };
      };`
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
