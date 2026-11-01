import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rerenderStateOnlyInHandlers } from "./rerender-state-only-in-handlers.js";

describe("rerender-state-only-in-handlers rendered state after self-echo", () => {
  it.each([
    "useEffect(() => { setVisible(request.length); }, [request]);",
    "useLayoutEffect(() => { setVisible(request.length); }, [request]);",
    "useEffect(() => { const current = request; switch (current.length) { case 1: setVisible(1); break; default: setVisible(0); } }, [request]);",
    "useEffect(() => { setVisible(() => request.length); }, [request]);",
    "setVisible.description = 'visible'; useEffect(() => { setVisible(request.length); }, [request]);",
    "[setVisible.description] = ['visible']; useEffect(() => { setVisible(request.length); }, [request]);",
    "let value; ({ [setVisible]: value } = {}); useEffect(() => { setVisible(request.length); }, [request]);",
    "let value; [value = setVisible] = []; useEffect(() => { setVisible(request.length); }, [request]);",
    "useEffect(() => { const setVisible = publish; setVisible(request.length); }, [request]);",
  ])("preserves rendered-state or independent payload consumption: %s", (consumer) => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `function Panel() {
        const [request, setRequest] = useState("");
        const [visible, setVisible] = useState(0);
        useEffect(() => { if (request.length > 3) setRequest(""); }, [request]);
        ${consumer}
        return <button onClick={() => setRequest("go")}>{visible}</button>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("preserves the dependency when the rendered consumer appears first", () => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `function Panel() {
        const [request, setRequest] = useState("");
        const [visible, setVisible] = useState(0);
        useEffect(() => { setVisible(request.length); }, [request]);
        useEffect(() => { if (request.length > 3) setRequest(""); }, [request]);
        return <button onClick={() => setRequest("go")}>{visible}</button>;
      }`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    'useEffect(() => { if (request.length > 2) setRequest(""); }, [request]);',
    "useEffect(() => { setVisible(1); }, []);",
    '{ const request = "local"; useEffect(() => { setVisible(request.length); }, [request]); }',
    "useEffect(() => { return; setVisible(request.length); }, [request]);",
    "useEffect(() => { const setVisible = publish; if (request.length > 0) setVisible(1); }, [request]);",
    "useEffect(() => { const later = () => setVisible(request.length); }, [request]);",
  ])("retains the warning without a direct rendered-state publication: %s", (consumer) => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `function Panel() {
        const [request, setRequest] = useState("");
        const [visible, setVisible] = useState(0);
        useEffect(() => { if (request.length > 3) setRequest(""); }, [request]);
        ${consumer}
        return <button onClick={() => setRequest("go")}>{visible}</button>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain('"request"');
  });

  it.each([
    "setVisible = publish;",
    "[setVisible] = [publish];",
    "({ setVisible } = { setVisible: publish });",
    "setVisible ||= publish;",
    "[setVisible = publish] = [];",
    "for (setVisible of [publish]) {}",
  ])("preserves payload consumption despite a replaced visible setter: %s", (replacement) => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `function Panel() {
        const [request, setRequest] = useState("");
        let [visible, setVisible] = useState(0);
        ${replacement}
        useEffect(() => { if (request.length > 3) setRequest(""); }, [request]);
        useEffect(() => { setVisible(request.length); }, [request]);
        return <button onClick={() => setRequest("go")}>{visible}</button>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);

    const guardOnlyResult = runRule(
      rerenderStateOnlyInHandlers,
      `function Panel() {
        const [request, setRequest] = useState("");
        let [visible, setVisible] = useState(0);
        ${replacement}
        useEffect(() => { if (request.length > 3) setRequest(""); }, [request]);
        useEffect(() => { if (request.length > 0) setVisible(1); }, [request]);
        return <button onClick={() => setRequest("go")}>{visible}</button>;
      }`,
    );
    expect(guardOnlyResult.parseErrors).toEqual([]);
    expect(guardOnlyResult.diagnostics).toHaveLength(1);
    expect(guardOnlyResult.diagnostics[0].message).toContain('"request"');
  });

  it("does not treat an unrendered state cycle as rendered output", () => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `function Panel() {
        const [request, setRequest] = useState(false);
        const [next, setNext] = useState(false);
        useEffect(() => { if (request) setRequest(false); }, [request]);
        useEffect(() => { if (next) setNext(false); }, [next]);
        useEffect(() => { setNext(request); }, [request]);
        useEffect(() => { setRequest(next); }, [next]);
        return <button onClick={() => setRequest(true)}>Start</button>;
      }`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });
});
