import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noChainStateUpdates } from "./no-chain-state-updates.js";

interface MeasurementCase {
  name: string;
  body: string;
  expected: number;
  setup?: string;
  extra?: string;
  tag?: string;
  attributes?: string;
  surroundingStart?: string;
  surroundingEnd?: string;
}

const cases: MeasurementCase[] = [
  {
    name: "quoted-width",
    body: "if (!viewportRef.current) return;\nsetWidth(viewportRef.current['scrollWidth']);",
    expected: 0,
  },
  {
    name: "template-width",
    body: "if (!viewportRef.current) return;\nsetWidth(viewportRef.current[`scrollWidth`]);",
    expected: 0,
  },
  {
    name: "quoted-current",
    body: "if (!viewportRef['current']) return;\nsetWidth(viewportRef['current'].scrollWidth);",
    expected: 0,
  },
  {
    name: "receiver-alias",
    body: "const element = viewportRef['current'];\nif (!element) return;\nsetWidth(element['scrollWidth']);",
    expected: 0,
  },
  {
    name: "measurement-alias",
    body: "if (!viewportRef.current) return;\nconst measured = viewportRef.current['scrollWidth'];\nsetWidth(measured);",
    expected: 0,
  },
  {
    name: "rectangle-method",
    body: "if (!viewportRef.current) return;\nsetWidth(viewportRef.current['getBoundingClientRect']().width);",
    expected: 0,
  },
  {
    name: "comparison",
    body: "if (!viewportRef.current) return;\nsetWidth(viewportRef.current['scrollWidth'] > viewportRef.current['clientWidth']);",
    expected: 0,
  },
  {
    name: "nullish-fallback",
    body: "if (!viewportRef.current) return;\nsetWidth(viewportRef.current?.['scrollWidth'] ?? 0);",
    expected: 0,
  },
  {
    name: "same-state-other-write",
    body: "if (!viewportRef.current) return;\nsetWidth(viewportRef.current['scrollWidth']);\nsetWidth(1);",
    expected: 1,
  },
  {
    name: "dot-width",
    body: "if (!viewportRef.current) return;\nsetWidth(viewportRef.current.scrollWidth);",
    expected: 0,
  },
  {
    name: "quoted-bare-ref",
    body: "if (!viewportRef.current) return;\nsetWidth(viewportRef['current']);",
    expected: 1,
  },
  {
    name: "unknown-key",
    body: "if (!viewportRef.current) return;\nsetWidth(viewportRef.current[metricKey]);",
    expected: 1,
  },
  {
    name: "computed-template",
    body: "if (!viewportRef.current) return;\nsetWidth(viewportRef.current[`${metricKey}`]);",
    expected: 1,
  },
  {
    name: "plain-data",
    body: "setWidth(metrics['scrollWidth']);",
    setup: "const metrics = { scrollWidth: 42 };",
    attributes: "onClick={() => setMode(!mode)}",
    expected: 1,
  },
  {
    name: "ref-lookalike",
    body: "if (!viewportRef.current) return;\nsetWidth(viewportRef.current['scrollWidth']);",
    setup: "const viewportRef = { current: { scrollWidth: 42 } };",
    attributes: "onClick={() => setMode(!mode)}",
    expected: 1,
  },
  {
    name: "unused-measurement",
    body: "if (!viewportRef.current) return;\nconst measured = viewportRef.current['scrollWidth'];\nsetWidth(1);",
    expected: 1,
  },
  {
    name: "discarded-measurement",
    body: "if (!viewportRef.current) return;\nsetWidth((viewportRef.current['scrollWidth'], 1));",
    expected: 1,
  },
  {
    name: "opaque-transform",
    body: "if (!viewportRef.current) return;\nsetWidth(makeValue(viewportRef.current['scrollWidth']));",
    expected: 1,
  },
  {
    name: "callback-value",
    body: "if (!viewportRef.current) return;\nsetWidth(() => { viewportRef.current['scrollWidth']; return 1; });",
    expected: 1,
  },
  {
    name: "stored-method",
    body: "if (!viewportRef.current) return;\nsetWidth(viewportRef.current['getBoundingClientRect']);",
    expected: 1,
  },
  {
    name: "method-replacement",
    body: "if (!viewportRef.current) return;\nsetWidth(viewportRef.current['getBoundingClientRect']().width);",
    extra:
      "if (viewportRef.current) viewportRef.current.getBoundingClientRect = () => ({ width: 77 });",
    expected: 1,
  },
  {
    name: "ref-replacement",
    body: "if (!viewportRef.current) return;\nsetWidth(viewportRef.current['scrollWidth']);",
    extra: "viewportRef.current = createAnotherElement();",
    expected: 1,
  },
  {
    name: "element-escape",
    body: "if (!viewportRef.current) return;\nsetWidth(viewportRef.current['scrollWidth']);",
    extra: "if (viewportRef.current) borrow(viewportRef.current);",
    expected: 1,
  },
  {
    name: "related-element-escape",
    body: "if (!viewportRef.current) return;\nsetWidth(viewportRef.current['scrollWidth']);",
    extra: "if (viewportRef.current) borrow(viewportRef.current.parentElement);",
    expected: 1,
  },
  {
    name: "event-receiver",
    body: "if (!viewportRef.current) return;\nsetWidth(viewportRef.current['scrollWidth']);",
    attributes:
      "ref={viewportRef} onClick={(event) => { Object.defineProperty(event.currentTarget, 'scrollWidth', { value: 77 }); setMode(!mode); }}",
    expected: 1,
  },
  {
    name: "unknown-event",
    body: "if (!viewportRef.current) return;\nsetWidth(viewportRef.current['scrollWidth']);",
    attributes: "ref={viewportRef} onClick={handler}",
    expected: 1,
  },
  {
    name: "custom-host",
    body: "if (!viewportRef.current) return;\nsetWidth(viewportRef.current['scrollWidth']);",
    tag: "Custom",
    expected: 1,
  },
  {
    name: "customized-native",
    body: "if (!viewportRef.current) return;\nsetWidth(viewportRef.current['scrollWidth']);",
    attributes: 'is="custom-panel" ref={viewportRef} onClick={() => setMode(!mode)}',
    expected: 1,
  },
  {
    name: "spread-attributes",
    body: "if (!viewportRef.current) return;\nsetWidth(viewportRef.current['scrollWidth']);",
    attributes: "{...attrs} ref={viewportRef} onClick={() => setMode(!mode)}",
    expected: 1,
  },
  {
    name: "rectangle-identity-test",
    body: "if (!viewportRef.current) return; setWidth(viewportRef.current['getBoundingClientRect']() === null);",
    expected: 1,
  },
  {
    name: "constant-arithmetic",
    body: "if (!viewportRef.current) return; setWidth(viewportRef.current['scrollWidth'] * 0);",
    expected: 1,
  },
  {
    name: "native-parent-and-sibling",
    body: "if (!viewportRef.current) return; setWidth(viewportRef.current['scrollWidth']);",
    surroundingStart: "<section><span>Width</span>",
    surroundingEnd: "</section>",
    expected: 0,
  },
  {
    name: "ancestor-ref-replacement",
    body: "if (!viewportRef.current) return; setWidth(viewportRef.current['getBoundingClientRect']().width);",
    surroundingStart:
      "<section ref={parent => { if (parent?.firstElementChild) parent.firstElementChild.getBoundingClientRect = () => ({ width: 77 }); }}>",
    surroundingEnd: "</section>",
    expected: 1,
  },
  {
    name: "sibling-ref-replacement",
    body: "if (!viewportRef.current) return; setWidth(viewportRef.current['getBoundingClientRect']().width);",
    surroundingStart:
      "<section><span ref={sibling => { if (sibling?.nextElementSibling) sibling.nextElementSibling.getBoundingClientRect = () => ({ width: 77 }); }}/>",
    surroundingEnd: "</section>",
    expected: 1,
  },
  {
    name: "method-transform",
    body: "if (!viewportRef.current) return;\nsetWidth(viewportRef.current['getBoundingClientRect']().derived);",
    expected: 1,
  },
];

describe("no-chain-state-updates static DOM measurements", () => {
  it.each(cases)(
    "$name",
    ({
      body,
      expected,
      setup = "const viewportRef = useRef(null);",
      extra = "",
      tag = "div",
      attributes = "ref={viewportRef} onClick={() => setMode(!mode)}",
      surroundingStart = "",
      surroundingEnd = "",
    }) => {
      const result = runRule(
        noChainStateUpdates,
        `import { useEffect, useRef, useState } from "react";

export const Panel = ({ metricKey, Custom, handler }) => {
  ${setup}
  const [mode, setMode] = useState(false);
  const [width, setWidth] = useState(0);
  ${extra}
  useEffect(() => {
    ${body}
  }, [mode]);
  return ${surroundingStart}<${tag} ${attributes}>{width}</${tag}>${surroundingEnd};
};`,
        { forceJsx: true },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(expected);
    },
  );
});
