import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import type { RuleDiagnostic, RunRuleOptions } from "../../../test-utils/run-rule.js";
import { noPropCallbackInEffect } from "./no-prop-callback-in-effect.js";

interface FiniteNativeListenerStateCase {
  name: string;
  code: string;
  expectedDiagnostics: RuleDiagnostic[];
}

const nativeListenerStateOptions: RunRuleOptions = {
  filename: "synthetic-computed-native-listener.tsx",
  includeLocations: true,
  settings: {
    "react-doctor": {
      portedRuleMode: "curated",
      capabilities: ["react"],
    },
  },
};

const nativeListenerStateCases: FiniteNativeListenerStateCase[] = [
  {
    name: "closed-let-native-document-choice",
    code: `import * as React from "react";
export const Example = (props) => {
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  const handleMove = (event) => { setPosition({ x: event.clientX, y: event.clientY }); };
  function bindEvent(remove) {
    let method = "addEventListener";
    if (remove) method = "removeEventListener";
    document[method]("mousemove", handleMove, false);
  }
  React.useEffect(() => { bindEvent(); return () => bindEvent(true); }, []);
  React.useEffect(() => { props.onChange(position); }, [position]);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 26,
        line: 11,
        message:
          'Your parent re-renders on every local state change because this useEffect calls the prop "onChange" just to stay in sync.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "closed-let-native-window-choice",
    code: `import * as React from "react";
export const Example = (props) => {
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  const handleMove = (event) => { setPosition({ x: event.clientX, y: event.clientY }); };
  function bindEvent(remove) {
    let method = "addEventListener";
    if (remove) method = "removeEventListener";
    window[method]("mousemove", handleMove, false);
  }
  React.useEffect(() => { bindEvent(); return () => bindEvent(true); }, []);
  React.useEffect(() => { props.onChange(position); }, [position]);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 26,
        line: 11,
        message:
          'Your parent re-renders on every local state change because this useEffect calls the prop "onChange" just to stay in sync.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "old-direct-native-control",
    code: `import * as React from "react";
export const Example = (props) => {
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  const handleMove = (event) => { setPosition({ x: event.clientX, y: event.clientY }); };
  function bindEvent(remove) {
    let method = "addEventListener";
    if (remove) method = "removeEventListener";
    if (remove) document.removeEventListener("mousemove", handleMove, false);
    else document.addEventListener("mousemove", handleMove, false);
  }
  React.useEffect(() => { bindEvent(); return () => bindEvent(true); }, []);
  React.useEffect(() => { props.onChange(position); }, [position]);
  return null;
};
`,
    expectedDiagnostics: [],
  },
  {
    name: "third-method-write",
    code: `import * as React from "react";
export const Example = (props) => {
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  const handleMove = (event) => { setPosition({ x: event.clientX, y: event.clientY }); };
  function bindEvent(remove) {
    let method = "addEventListener";
    if (remove) method = "removeEventListener";
    if (props.extra) method = "invokeNow";
    document[method]("mousemove", handleMove, false);
  }
  React.useEffect(() => { bindEvent(); return () => bindEvent(true); }, []);
  React.useEffect(() => { props.onChange(position); }, [position]);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 26,
        line: 12,
        message:
          'Your parent re-renders on every local state change because this useEffect calls the prop "onChange" just to stay in sync.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "unknown-method-parameter",
    code: `import * as React from "react";
export const Example = (props) => {
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  const handleMove = (event) => { setPosition({ x: event.clientX, y: event.clientY }); };
  function bindEvent(remove) {
    let method = props.method;
    if (remove) method = "removeEventListener";
    document[method]("mousemove", handleMove, false);
  }
  React.useEffect(() => { bindEvent(); return () => bindEvent(true); }, []);
  React.useEffect(() => { props.onChange(position); }, [position]);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 26,
        line: 11,
        message:
          'Your parent re-renders on every local state change because this useEffect calls the prop "onChange" just to stay in sync.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "compound-method-write",
    code: `import * as React from "react";
export const Example = (props) => {
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  const handleMove = (event) => { setPosition({ x: event.clientX, y: event.clientY }); };
  function bindEvent(remove) {
    let method = "addEventListener";
    if (remove) method += "Suffix";
    document[method]("mousemove", handleMove, false);
  }
  React.useEffect(() => { bindEvent(); return () => bindEvent(true); }, []);
  React.useEffect(() => { props.onChange(position); }, [position]);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 26,
        line: 11,
        message:
          'Your parent re-renders on every local state change because this useEffect calls the prop "onChange" just to stay in sync.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "shadowed-document",
    code: `import * as React from "react";
export const Example = (props, document) => {
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  const handleMove = (event) => { setPosition({ x: event.clientX, y: event.clientY }); };
  function bindEvent(remove) {
    let method = "addEventListener";
    if (remove) method = "removeEventListener";
    document[method]("mousemove", handleMove, false);
  }
  React.useEffect(() => { bindEvent(); return () => bindEvent(true); }, []);
  React.useEffect(() => { props.onChange(position); }, [position]);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 26,
        line: 11,
        message:
          'Your parent re-renders on every local state change because this useEffect calls the prop "onChange" just to stay in sync.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "custom-immediate-receiver",
    code: `import * as React from "react";
export const Example = (props) => {
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  const handleMove = (event) => { setPosition({ x: event.clientX, y: event.clientY }); };
  function bindEvent(remove) {
    let method = "addEventListener";
    if (remove) method = "removeEventListener";
    props.target[method]("mousemove", handleMove, false);
  }
  React.useEffect(() => { bindEvent(); return () => bindEvent(true); }, []);
  React.useEffect(() => { props.onChange(position); }, [position]);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 26,
        line: 11,
        message:
          'Your parent re-renders on every local state change because this useEffect calls the prop "onChange" just to stay in sync.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "handler-extra-direct-call",
    code: `import * as React from "react";
export const Example = (props) => {
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  const handleMove = (event) => { setPosition({ x: event.clientX, y: event.clientY }); };
  function bindEvent(remove) {
    let method = "addEventListener";
    if (remove) method = "removeEventListener";
    document[method]("mousemove", handleMove, false);
  }
  React.useEffect(() => { bindEvent(); return () => bindEvent(true); }, []);
  React.useEffect(() => { props.onChange(position); }, [position]);
  return <button onClick={() => handleMove({ clientX: 1, clientY: 2 })}>Move</button>;
};
`,
    expectedDiagnostics: [
      {
        column: 26,
        line: 11,
        message:
          'Your parent re-renders on every local state change because this useEffect calls the prop "onChange" just to stay in sync.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "handler-extra-jsx-reference",
    code: `import * as React from "react";
export const Example = (props) => {
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  const handleMove = (event) => { setPosition({ x: event.clientX, y: event.clientY }); };
  function bindEvent(remove) {
    let method = "addEventListener";
    if (remove) method = "removeEventListener";
    document[method]("mousemove", handleMove, false);
  }
  React.useEffect(() => { bindEvent(); return () => bindEvent(true); }, []);
  React.useEffect(() => { props.onChange(position); }, [position]);
  return <div onMouseMove={handleMove} />;
};
`,
    expectedDiagnostics: [
      {
        column: 26,
        line: 11,
        message:
          'Your parent re-renders on every local state change because this useEffect calls the prop "onChange" just to stay in sync.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "handler-alias-escape",
    code: `import * as React from "react";
export const Example = (props) => {
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  const handleMove = (event) => { setPosition({ x: event.clientX, y: event.clientY }); };
  function bindEvent(remove) {
    let method = "addEventListener";
    if (remove) method = "removeEventListener";
    document[method]("mousemove", handleMove, false);
  }
  props.capture(handleMove);
  React.useEffect(() => { bindEvent(); return () => bindEvent(true); }, []);
  React.useEffect(() => { props.onChange(position); }, [position]);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 26,
        line: 12,
        message:
          'Your parent re-renders on every local state change because this useEffect calls the prop "onChange" just to stay in sync.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "setter-extra-react-writer",
    code: `import * as React from "react";
export const Example = (props) => {
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  const handleMove = (event) => { setPosition({ x: event.clientX, y: event.clientY }); };
  function bindEvent(remove) {
    let method = "addEventListener";
    if (remove) method = "removeEventListener";
    document[method]("mousemove", handleMove, false);
  }
  React.useEffect(() => { bindEvent(); return () => bindEvent(true); }, []);
  React.useEffect(() => { props.onChange(position); }, [position]);
  return <button onClick={() => setPosition({ x: 1, y: 2 })}>Write</button>;
};
`,
    expectedDiagnostics: [
      {
        column: 26,
        line: 11,
        message:
          'Your parent re-renders on every local state change because this useEffect calls the prop "onChange" just to stay in sync.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "setter-alias-escape",
    code: `import * as React from "react";
export const Example = (props) => {
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  const handleMove = (event) => { setPosition({ x: event.clientX, y: event.clientY }); };
  function bindEvent(remove) {
    let method = "addEventListener";
    if (remove) method = "removeEventListener";
    document[method]("mousemove", handleMove, false);
  }
  React.useEffect(() => { bindEvent(); return () => bindEvent(true); }, []);
  React.useEffect(() => { props.onChange(position); }, [position]);
  props.capture(setPosition);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 26,
        line: 11,
        message:
          'Your parent re-renders on every local state change because this useEffect calls the prop "onChange" just to stay in sync.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "wrong-callback-argument-slot",
    code: `import * as React from "react";
export const Example = (props) => {
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  const handleMove = (event) => { setPosition({ x: event.clientX, y: event.clientY }); };
  function bindEvent(remove) {
    let method = "addEventListener";
    if (remove) method = "removeEventListener";
    document[method](handleMove, "mousemove", false);
  }
  React.useEffect(() => { bindEvent(); return () => bindEvent(true); }, []);
  React.useEffect(() => { props.onChange(position); }, [position]);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 26,
        line: 11,
        message:
          'Your parent re-renders on every local state change because this useEffect calls the prop "onChange" just to stay in sync.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "getter-options-side-effect",
    code: `import * as React from "react";
export const Example = (props) => {
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  const handleMove = (event) => { setPosition({ x: event.clientX, y: event.clientY }); };
  function bindEvent(remove) {
    let method = "addEventListener";
    if (remove) method = "removeEventListener";
    document[method]("mousemove", handleMove, { get capture() { setPosition({ x: 1, y: 2 }); return false; } });
  }
  React.useEffect(() => { bindEvent(); return () => bindEvent(true); }, []);
  React.useEffect(() => { props.onChange(position); }, [position]);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 26,
        line: 11,
        message:
          'Your parent re-renders on every local state change because this useEffect calls the prop "onChange" just to stay in sync.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "visible-native-provider-write",
    code: `document.addEventListener = (name, listener) => listener({ clientX: 1, clientY: 2 });
import * as React from "react";
export const Example = (props) => {
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  const handleMove = (event) => { setPosition({ x: event.clientX, y: event.clientY }); };
  function bindEvent(remove) {
    let method = "addEventListener";
    if (remove) method = "removeEventListener";
    document[method]("mousemove", handleMove, false);
  }
  React.useEffect(() => { bindEvent(); return () => bindEvent(true); }, []);
  React.useEffect(() => { props.onChange(position); }, [position]);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 26,
        line: 12,
        message:
          'Your parent re-renders on every local state change because this useEffect calls the prop "onChange" just to stay in sync.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "direct-eval-provider-write",
    code: `eval("document.addEventListener = (name, listener) => listener({clientX:1, clientY:2})");
import * as React from "react";
export const Example = (props) => {
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  const handleMove = (event) => { setPosition({ x: event.clientX, y: event.clientY }); };
  function bindEvent(remove) {
    let method = "addEventListener";
    if (remove) method = "removeEventListener";
    document[method]("mousemove", handleMove, false);
  }
  React.useEffect(() => { bindEvent(); return () => bindEvent(true); }, []);
  React.useEffect(() => { props.onChange(position); }, [position]);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 26,
        line: 12,
        message:
          'Your parent re-renders on every local state change because this useEffect calls the prop "onChange" just to stay in sync.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "dynamic-loader-provider-execution",
    code: `const runtime = await import("node:vm");
runtime.runInThisContext("document.addEventListener = (name, listener) => listener({clientX:1,clientY:2})");
import * as React from "react";
export const Example = (props) => {
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  const handleMove = (event) => { setPosition({ x: event.clientX, y: event.clientY }); };
  function bindEvent(remove) {
    let method = "addEventListener";
    if (remove) method = "removeEventListener";
    document[method]("mousemove", handleMove, false);
  }
  React.useEffect(() => { bindEvent(); return () => bindEvent(true); }, []);
  React.useEffect(() => { props.onChange(position); }, [position]);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 26,
        line: 13,
        message:
          'Your parent re-renders on every local state change because this useEffect calls the prop "onChange" just to stay in sync.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "method-read-escape",
    code: `import * as React from "react";
export const Example = (props) => {
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  const handleMove = (event) => { setPosition({ x: event.clientX, y: event.clientY }); };
  function bindEvent(remove) {
    let method = "addEventListener";
    if (remove) method = "removeEventListener";
    props.capture(method);
    document[method]("mousemove", handleMove, false);
  }
  React.useEffect(() => { bindEvent(); return () => bindEvent(true); }, []);
  React.useEffect(() => { props.onChange(position); }, [position]);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 26,
        line: 12,
        message:
          'Your parent re-renders on every local state change because this useEffect calls the prop "onChange" just to stay in sync.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "handler-object-not-function",
    code: `import * as React from "react";
export const Example = (props) => {
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  const handleMove = { handleEvent(event) { setPosition({ x: event.clientX, y: event.clientY }); } };
  function bindEvent(remove) {
    let method = "addEventListener";
    if (remove) method = "removeEventListener";
    document[method]("mousemove", handleMove, false);
  }
  React.useEffect(() => { bindEvent(); return () => bindEvent(true); }, []);
  React.useEffect(() => { props.onChange(position); }, [position]);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 26,
        line: 11,
        message:
          'Your parent re-renders on every local state change because this useEffect calls the prop "onChange" just to stay in sync.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "remove-only-no-registration",
    code: `import * as React from "react";
export const Example = (props) => {
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  const handleMove = (event) => { setPosition({ x: event.clientX, y: event.clientY }); };
  function bindEvent(remove) {
    let method = "removeEventListener";
    if (remove) method = "removeEventListener";
    document[method]("mousemove", handleMove, false);
  }
  React.useEffect(() => { bindEvent(); return () => bindEvent(true); }, []);
  React.useEffect(() => { props.onChange(position); }, [position]);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 26,
        line: 11,
        message:
          'Your parent re-renders on every local state change because this useEffect calls the prop "onChange" just to stay in sync.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "partial-finite-conditional",
    code: `import * as React from "react";
export const Example = (props) => {
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  const handleMove = (event) => { setPosition({ x: event.clientX, y: event.clientY }); };
  function bindEvent(remove) {
    const method = remove ? "removeEventListener" : props.unknown;
    document[method]("mousemove", handleMove, false);
  }
  React.useEffect(() => { bindEvent(); return () => bindEvent(true); }, []);
  React.useEffect(() => { props.onChange(position); }, [position]);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 26,
        line: 10,
        message:
          'Your parent re-renders on every local state change because this useEffect calls the prop "onChange" just to stay in sync.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "erased-react-provider",
    code: `import type * as React from "react";
export const Example = (props) => {
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  const handleMove = (event) => { setPosition({ x: event.clientX, y: event.clientY }); };
  function bindEvent(remove) {
    let method = "addEventListener";
    if (remove) method = "removeEventListener";
    document[method]("mousemove", handleMove, false);
  }
  React.useEffect(() => { bindEvent(); return () => bindEvent(true); }, []);
  React.useEffect(() => { props.onChange(position); }, [position]);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 26,
        line: 11,
        message:
          'Your parent re-renders on every local state change because this useEffect calls the prop "onChange" just to stay in sync.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "visible-programmatic-native-dispatch",
    code: `import * as React from "react";
export const Example = (props) => {
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  const handleMove = (event) => { setPosition({ x: event.clientX, y: event.clientY }); };
  function bindEvent(remove) {
    let method = "addEventListener";
    if (remove) method = "removeEventListener";
    document[method]("mousemove", handleMove, false);
  }
  React.useEffect(() => { bindEvent(); return () => bindEvent(true); }, []);
  React.useEffect(() => { props.onChange(position); }, [position]);
  return <button onClick={() => document.dispatchEvent(new MouseEvent("mousemove", { clientX: 1, clientY: 2 }))}>Dispatch</button>;
};
`,
    expectedDiagnostics: [
      {
        column: 26,
        line: 11,
        message:
          'Your parent re-renders on every local state change because this useEffect calls the prop "onChange" just to stay in sync.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "scalar-payload-closed-let-native-document-choice",
    code: `import * as React from "react";
export const Example = (props) => {
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  const handleMove = (event) => { setPosition({ x: event.clientX, y: event.clientY }); };
  function bindEvent(remove) {
    let method = "addEventListener";
    if (remove) method = "removeEventListener";
    document[method]("mousemove", handleMove, false);
  }
  React.useEffect(() => { bindEvent(); return () => bindEvent(true); }, []);
  React.useEffect(() => { props.onChange(position.x, position.y); }, [position]);
  return null;
};
`,
    expectedDiagnostics: [],
  },
  {
    name: "scalar-payload-closed-let-native-window-choice",
    code: `import * as React from "react";
export const Example = (props) => {
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  const handleMove = (event) => { setPosition({ x: event.clientX, y: event.clientY }); };
  function bindEvent(remove) {
    let method = "addEventListener";
    if (remove) method = "removeEventListener";
    window[method]("mousemove", handleMove, false);
  }
  React.useEffect(() => { bindEvent(); return () => bindEvent(true); }, []);
  React.useEffect(() => { props.onChange(position.x, position.y); }, [position]);
  return null;
};
`,
    expectedDiagnostics: [],
  },
  {
    name: "scalar-payload-third-method-write",
    code: `import * as React from "react";
export const Example = (props) => {
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  const handleMove = (event) => { setPosition({ x: event.clientX, y: event.clientY }); };
  function bindEvent(remove) {
    let method = "addEventListener";
    if (remove) method = "removeEventListener";
    if (props.extra) method = "invokeNow";
    document[method]("mousemove", handleMove, false);
  }
  React.useEffect(() => { bindEvent(); return () => bindEvent(true); }, []);
  React.useEffect(() => { props.onChange(position.x, position.y); }, [position]);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 26,
        line: 12,
        message:
          'Your parent re-renders on every local state change because this useEffect calls the prop "onChange" just to stay in sync.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "scalar-payload-unknown-method-parameter",
    code: `import * as React from "react";
export const Example = (props) => {
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  const handleMove = (event) => { setPosition({ x: event.clientX, y: event.clientY }); };
  function bindEvent(remove) {
    let method = props.method;
    if (remove) method = "removeEventListener";
    document[method]("mousemove", handleMove, false);
  }
  React.useEffect(() => { bindEvent(); return () => bindEvent(true); }, []);
  React.useEffect(() => { props.onChange(position.x, position.y); }, [position]);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 26,
        line: 11,
        message:
          'Your parent re-renders on every local state change because this useEffect calls the prop "onChange" just to stay in sync.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "scalar-payload-compound-method-write",
    code: `import * as React from "react";
export const Example = (props) => {
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  const handleMove = (event) => { setPosition({ x: event.clientX, y: event.clientY }); };
  function bindEvent(remove) {
    let method = "addEventListener";
    if (remove) method += "Suffix";
    document[method]("mousemove", handleMove, false);
  }
  React.useEffect(() => { bindEvent(); return () => bindEvent(true); }, []);
  React.useEffect(() => { props.onChange(position.x, position.y); }, [position]);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 26,
        line: 11,
        message:
          'Your parent re-renders on every local state change because this useEffect calls the prop "onChange" just to stay in sync.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "scalar-payload-shadowed-document",
    code: `import * as React from "react";
export const Example = (props, document) => {
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  const handleMove = (event) => { setPosition({ x: event.clientX, y: event.clientY }); };
  function bindEvent(remove) {
    let method = "addEventListener";
    if (remove) method = "removeEventListener";
    document[method]("mousemove", handleMove, false);
  }
  React.useEffect(() => { bindEvent(); return () => bindEvent(true); }, []);
  React.useEffect(() => { props.onChange(position.x, position.y); }, [position]);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 26,
        line: 11,
        message:
          'Your parent re-renders on every local state change because this useEffect calls the prop "onChange" just to stay in sync.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "scalar-payload-custom-immediate-receiver",
    code: `import * as React from "react";
export const Example = (props) => {
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  const handleMove = (event) => { setPosition({ x: event.clientX, y: event.clientY }); };
  function bindEvent(remove) {
    let method = "addEventListener";
    if (remove) method = "removeEventListener";
    props.target[method]("mousemove", handleMove, false);
  }
  React.useEffect(() => { bindEvent(); return () => bindEvent(true); }, []);
  React.useEffect(() => { props.onChange(position.x, position.y); }, [position]);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 26,
        line: 11,
        message:
          'Your parent re-renders on every local state change because this useEffect calls the prop "onChange" just to stay in sync.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "scalar-payload-handler-extra-direct-call",
    code: `import * as React from "react";
export const Example = (props) => {
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  const handleMove = (event) => { setPosition({ x: event.clientX, y: event.clientY }); };
  function bindEvent(remove) {
    let method = "addEventListener";
    if (remove) method = "removeEventListener";
    document[method]("mousemove", handleMove, false);
  }
  React.useEffect(() => { bindEvent(); return () => bindEvent(true); }, []);
  React.useEffect(() => { props.onChange(position.x, position.y); }, [position]);
  return <button onClick={() => handleMove({ clientX: 1, clientY: 2 })}>Move</button>;
};
`,
    expectedDiagnostics: [
      {
        column: 26,
        line: 11,
        message:
          'Your parent re-renders on every local state change because this useEffect calls the prop "onChange" just to stay in sync.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "scalar-payload-handler-extra-jsx-reference",
    code: `import * as React from "react";
export const Example = (props) => {
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  const handleMove = (event) => { setPosition({ x: event.clientX, y: event.clientY }); };
  function bindEvent(remove) {
    let method = "addEventListener";
    if (remove) method = "removeEventListener";
    document[method]("mousemove", handleMove, false);
  }
  React.useEffect(() => { bindEvent(); return () => bindEvent(true); }, []);
  React.useEffect(() => { props.onChange(position.x, position.y); }, [position]);
  return <div onMouseMove={handleMove} />;
};
`,
    expectedDiagnostics: [
      {
        column: 26,
        line: 11,
        message:
          'Your parent re-renders on every local state change because this useEffect calls the prop "onChange" just to stay in sync.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "scalar-payload-handler-alias-escape",
    code: `import * as React from "react";
export const Example = (props) => {
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  const handleMove = (event) => { setPosition({ x: event.clientX, y: event.clientY }); };
  function bindEvent(remove) {
    let method = "addEventListener";
    if (remove) method = "removeEventListener";
    document[method]("mousemove", handleMove, false);
  }
  props.capture(handleMove);
  React.useEffect(() => { bindEvent(); return () => bindEvent(true); }, []);
  React.useEffect(() => { props.onChange(position.x, position.y); }, [position]);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 26,
        line: 12,
        message:
          'Your parent re-renders on every local state change because this useEffect calls the prop "onChange" just to stay in sync.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "scalar-payload-setter-extra-react-writer",
    code: `import * as React from "react";
export const Example = (props) => {
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  const handleMove = (event) => { setPosition({ x: event.clientX, y: event.clientY }); };
  function bindEvent(remove) {
    let method = "addEventListener";
    if (remove) method = "removeEventListener";
    document[method]("mousemove", handleMove, false);
  }
  React.useEffect(() => { bindEvent(); return () => bindEvent(true); }, []);
  React.useEffect(() => { props.onChange(position.x, position.y); }, [position]);
  return <button onClick={() => setPosition({ x: 1, y: 2 })}>Write</button>;
};
`,
    expectedDiagnostics: [
      {
        column: 26,
        line: 11,
        message:
          'Your parent re-renders on every local state change because this useEffect calls the prop "onChange" just to stay in sync.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "scalar-payload-setter-alias-escape",
    code: `import * as React from "react";
export const Example = (props) => {
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  const handleMove = (event) => { setPosition({ x: event.clientX, y: event.clientY }); };
  function bindEvent(remove) {
    let method = "addEventListener";
    if (remove) method = "removeEventListener";
    document[method]("mousemove", handleMove, false);
  }
  React.useEffect(() => { bindEvent(); return () => bindEvent(true); }, []);
  React.useEffect(() => { props.onChange(position.x, position.y); }, [position]);
  props.capture(setPosition);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 26,
        line: 11,
        message:
          'Your parent re-renders on every local state change because this useEffect calls the prop "onChange" just to stay in sync.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "scalar-payload-wrong-callback-argument-slot",
    code: `import * as React from "react";
export const Example = (props) => {
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  const handleMove = (event) => { setPosition({ x: event.clientX, y: event.clientY }); };
  function bindEvent(remove) {
    let method = "addEventListener";
    if (remove) method = "removeEventListener";
    document[method](handleMove, "mousemove", false);
  }
  React.useEffect(() => { bindEvent(); return () => bindEvent(true); }, []);
  React.useEffect(() => { props.onChange(position.x, position.y); }, [position]);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 26,
        line: 11,
        message:
          'Your parent re-renders on every local state change because this useEffect calls the prop "onChange" just to stay in sync.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "scalar-payload-getter-options-side-effect",
    code: `import * as React from "react";
export const Example = (props) => {
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  const handleMove = (event) => { setPosition({ x: event.clientX, y: event.clientY }); };
  function bindEvent(remove) {
    let method = "addEventListener";
    if (remove) method = "removeEventListener";
    document[method]("mousemove", handleMove, { get capture() { setPosition({ x: 1, y: 2 }); return false; } });
  }
  React.useEffect(() => { bindEvent(); return () => bindEvent(true); }, []);
  React.useEffect(() => { props.onChange(position.x, position.y); }, [position]);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 26,
        line: 11,
        message:
          'Your parent re-renders on every local state change because this useEffect calls the prop "onChange" just to stay in sync.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "scalar-payload-visible-native-provider-write",
    code: `document.addEventListener = (name, listener) => listener({ clientX: 1, clientY: 2 });
import * as React from "react";
export const Example = (props) => {
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  const handleMove = (event) => { setPosition({ x: event.clientX, y: event.clientY }); };
  function bindEvent(remove) {
    let method = "addEventListener";
    if (remove) method = "removeEventListener";
    document[method]("mousemove", handleMove, false);
  }
  React.useEffect(() => { bindEvent(); return () => bindEvent(true); }, []);
  React.useEffect(() => { props.onChange(position.x, position.y); }, [position]);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 26,
        line: 12,
        message:
          'Your parent re-renders on every local state change because this useEffect calls the prop "onChange" just to stay in sync.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "scalar-payload-direct-eval-provider-write",
    code: `eval("document.addEventListener = (name, listener) => listener({clientX:1, clientY:2})");
import * as React from "react";
export const Example = (props) => {
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  const handleMove = (event) => { setPosition({ x: event.clientX, y: event.clientY }); };
  function bindEvent(remove) {
    let method = "addEventListener";
    if (remove) method = "removeEventListener";
    document[method]("mousemove", handleMove, false);
  }
  React.useEffect(() => { bindEvent(); return () => bindEvent(true); }, []);
  React.useEffect(() => { props.onChange(position.x, position.y); }, [position]);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 26,
        line: 12,
        message:
          'Your parent re-renders on every local state change because this useEffect calls the prop "onChange" just to stay in sync.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "scalar-payload-dynamic-loader-provider-execution",
    code: `const runtime = await import("node:vm");
runtime.runInThisContext("document.addEventListener = (name, listener) => listener({clientX:1,clientY:2})");
import * as React from "react";
export const Example = (props) => {
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  const handleMove = (event) => { setPosition({ x: event.clientX, y: event.clientY }); };
  function bindEvent(remove) {
    let method = "addEventListener";
    if (remove) method = "removeEventListener";
    document[method]("mousemove", handleMove, false);
  }
  React.useEffect(() => { bindEvent(); return () => bindEvent(true); }, []);
  React.useEffect(() => { props.onChange(position.x, position.y); }, [position]);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 26,
        line: 13,
        message:
          'Your parent re-renders on every local state change because this useEffect calls the prop "onChange" just to stay in sync.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "scalar-payload-method-read-escape",
    code: `import * as React from "react";
export const Example = (props) => {
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  const handleMove = (event) => { setPosition({ x: event.clientX, y: event.clientY }); };
  function bindEvent(remove) {
    let method = "addEventListener";
    if (remove) method = "removeEventListener";
    props.capture(method);
    document[method]("mousemove", handleMove, false);
  }
  React.useEffect(() => { bindEvent(); return () => bindEvent(true); }, []);
  React.useEffect(() => { props.onChange(position.x, position.y); }, [position]);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 26,
        line: 12,
        message:
          'Your parent re-renders on every local state change because this useEffect calls the prop "onChange" just to stay in sync.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "scalar-payload-handler-object-not-function",
    code: `import * as React from "react";
export const Example = (props) => {
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  const handleMove = { handleEvent(event) { setPosition({ x: event.clientX, y: event.clientY }); } };
  function bindEvent(remove) {
    let method = "addEventListener";
    if (remove) method = "removeEventListener";
    document[method]("mousemove", handleMove, false);
  }
  React.useEffect(() => { bindEvent(); return () => bindEvent(true); }, []);
  React.useEffect(() => { props.onChange(position.x, position.y); }, [position]);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 26,
        line: 11,
        message:
          'Your parent re-renders on every local state change because this useEffect calls the prop "onChange" just to stay in sync.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "scalar-payload-remove-only-no-registration",
    code: `import * as React from "react";
export const Example = (props) => {
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  const handleMove = (event) => { setPosition({ x: event.clientX, y: event.clientY }); };
  function bindEvent(remove) {
    let method = "removeEventListener";
    if (remove) method = "removeEventListener";
    document[method]("mousemove", handleMove, false);
  }
  React.useEffect(() => { bindEvent(); return () => bindEvent(true); }, []);
  React.useEffect(() => { props.onChange(position.x, position.y); }, [position]);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 26,
        line: 11,
        message:
          'Your parent re-renders on every local state change because this useEffect calls the prop "onChange" just to stay in sync.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "scalar-payload-partial-finite-conditional",
    code: `import * as React from "react";
export const Example = (props) => {
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  const handleMove = (event) => { setPosition({ x: event.clientX, y: event.clientY }); };
  function bindEvent(remove) {
    const method = remove ? "removeEventListener" : props.unknown;
    document[method]("mousemove", handleMove, false);
  }
  React.useEffect(() => { bindEvent(); return () => bindEvent(true); }, []);
  React.useEffect(() => { props.onChange(position.x, position.y); }, [position]);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 26,
        line: 10,
        message:
          'Your parent re-renders on every local state change because this useEffect calls the prop "onChange" just to stay in sync.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "scalar-payload-erased-react-provider",
    code: `import type * as React from "react";
export const Example = (props) => {
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  const handleMove = (event) => { setPosition({ x: event.clientX, y: event.clientY }); };
  function bindEvent(remove) {
    let method = "addEventListener";
    if (remove) method = "removeEventListener";
    document[method]("mousemove", handleMove, false);
  }
  React.useEffect(() => { bindEvent(); return () => bindEvent(true); }, []);
  React.useEffect(() => { props.onChange(position.x, position.y); }, [position]);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 26,
        line: 11,
        message:
          'Your parent re-renders on every local state change because this useEffect calls the prop "onChange" just to stay in sync.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "scalar-payload-visible-programmatic-native-dispatch",
    code: `import * as React from "react";
export const Example = (props) => {
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  const handleMove = (event) => { setPosition({ x: event.clientX, y: event.clientY }); };
  function bindEvent(remove) {
    let method = "addEventListener";
    if (remove) method = "removeEventListener";
    document[method]("mousemove", handleMove, false);
  }
  React.useEffect(() => { bindEvent(); return () => bindEvent(true); }, []);
  React.useEffect(() => { props.onChange(position.x, position.y); }, [position]);
  return <button onClick={() => document.dispatchEvent(new MouseEvent("mousemove", { clientX: 1, clientY: 2 }))}>Dispatch</button>;
};
`,
    expectedDiagnostics: [
      {
        column: 26,
        line: 11,
        message:
          'Your parent re-renders on every local state change because this useEffect calls the prop "onChange" just to stay in sync.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "scalar-bubbling-element-dispatch",
    code: `import * as React from "react";
export const Example = (props) => {
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  const handleMove = (event) => { setPosition({ x: event.clientX, y: event.clientY }); };
  function bindEvent(remove) {
    let method = "addEventListener";
    if (remove) method = "removeEventListener";
    document[method]("mousemove", handleMove, false);
  }
  React.useEffect(() => { bindEvent(); return () => bindEvent(true); }, []);
  React.useEffect(() => { props.onChange(position.x, position.y); }, [position]);
  return <button onClick={() => document.createElement("div").dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 1, clientY: 2 }))}>Dispatch</button>;
};
`,
    expectedDiagnostics: [
      {
        column: 26,
        line: 11,
        message:
          'Your parent re-renders on every local state change because this useEffect calls the prop "onChange" just to stay in sync.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "scalar-unknown-event-dispatch",
    code: `import * as React from "react";
export const Example = (props) => {
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  const handleMove = (event) => { setPosition({ x: event.clientX, y: event.clientY }); };
  function bindEvent(remove) {
    let method = "addEventListener";
    if (remove) method = "removeEventListener";
    document[method]("mousemove", handleMove, false);
  }
  React.useEffect(() => { bindEvent(); return () => bindEvent(true); }, []);
  React.useEffect(() => { props.onChange(position.x, position.y); }, [position]);
  return <button onClick={() => document.dispatchEvent(props.event)}>Dispatch</button>;
};
`,
    expectedDiagnostics: [
      {
        column: 26,
        line: 11,
        message:
          'Your parent re-renders on every local state change because this useEffect calls the prop "onChange" just to stay in sync.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "scalar-extracted-bound-dispatch-call",
    code: `import * as React from "react";
export const Example = (props) => {
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  const handleMove = (event) => { setPosition({ x: event.clientX, y: event.clientY }); };
  function bindEvent(remove) {
    let method = "addEventListener";
    if (remove) method = "removeEventListener";
    document[method]("mousemove", handleMove, false);
  }
  React.useEffect(() => { bindEvent(); return () => bindEvent(true); }, []);
  React.useEffect(() => { props.onChange(position.x, position.y); }, [position]);
  const dispatch = document.dispatchEvent.bind(document);
  return <button onClick={() => dispatch.call(null, new MouseEvent("mousemove", { clientX: 1, clientY: 2 }))}>Dispatch</button>;
};
`,
    expectedDiagnostics: [
      {
        column: 26,
        line: 11,
        message:
          'Your parent re-renders on every local state change because this useEffect calls the prop "onChange" just to stay in sync.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "scalar-nested-captured-selector-write",
    code: `import * as React from "react";
export const Example = (props) => {
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  const handleMove = (event) => { setPosition({ x: event.clientX, y: event.clientY }); };
  function bindEvent(remove) {
    let method = "addEventListener";
    if (remove) method = "removeEventListener";
    const rewrite = () => { method = props.method; };
    rewrite();
    document[method]("mousemove", handleMove, false);
  }
  React.useEffect(() => { bindEvent(); return () => bindEvent(true); }, []);
  React.useEffect(() => { props.onChange(position.x, position.y); }, [position]);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 26,
        line: 13,
        message:
          'Your parent re-renders on every local state change because this useEffect calls the prop "onChange" just to stay in sync.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "scalar-selected-setter-reassignment",
    code: `import * as React from "react";
export const Example = (props) => {
  let [position, setPosition] = React.useState({ x: 0, y: 0 });
  const handleMove = (event) => { setPosition({ x: event.clientX, y: event.clientY }); };
  setPosition = props.writer;
  function bindEvent(remove) {
    let method = "addEventListener";
    if (remove) method = "removeEventListener";
    document[method]("mousemove", handleMove, false);
  }
  React.useEffect(() => { bindEvent(); return () => bindEvent(true); }, []);
  React.useEffect(() => { props.onChange(position.x, position.y); }, [position]);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 26,
        line: 12,
        message:
          'Your parent re-renders on every local state change because this useEffect calls the prop "onChange" just to stay in sync.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "scalar-selected-handler-reassignment",
    code: `import * as React from "react";
export const Example = (props) => {
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  let handleMove = (event) => { setPosition({ x: event.clientX, y: event.clientY }); };
  handleMove = (event) => { setPosition({ x: props.x, y: props.y }); };
  function bindEvent(remove) {
    let method = "addEventListener";
    if (remove) method = "removeEventListener";
    document[method]("mousemove", handleMove, false);
  }
  React.useEffect(() => { bindEvent(); return () => bindEvent(true); }, []);
  React.useEffect(() => { props.onChange(position.x, position.y); }, [position]);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 26,
        line: 12,
        message:
          'Your parent re-renders on every local state change because this useEffect calls the prop "onChange" just to stay in sync.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "scalar-visible-state-field-write",
    code: `import * as React from "react";
export const Example = (props) => {
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  const handleMove = (event) => { setPosition({ x: event.clientX, y: event.clientY }); };
  function bindEvent(remove) {
    let method = "addEventListener";
    if (remove) method = "removeEventListener";
    document[method]("mousemove", handleMove, false);
  }
  React.useEffect(() => { bindEvent(); return () => bindEvent(true); }, []);
  position.x = props.x;
  React.useEffect(() => { props.onChange(position.x, position.y); }, [position, props.revision]);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 26,
        line: 12,
        message:
          'Your parent re-renders on every local state change because this useEffect calls the prop "onChange" just to stay in sync.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "scalar-state-alias-write",
    code: `import * as React from "react";
export const Example = (props) => {
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  const handleMove = (event) => { setPosition({ x: event.clientX, y: event.clientY }); };
  function bindEvent(remove) {
    let method = "addEventListener";
    if (remove) method = "removeEventListener";
    document[method]("mousemove", handleMove, false);
  }
  React.useEffect(() => { bindEvent(); return () => bindEvent(true); }, []);
  const localPosition = position;
  localPosition.x = props.x;
  React.useEffect(() => { props.onChange(position.x, position.y); }, [position, props.revision]);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 26,
        line: 13,
        message:
          'Your parent re-renders on every local state change because this useEffect calls the prop "onChange" just to stay in sync.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "scalar-aliased-prototype-provider-replacement",
    code: `const nativeTarget = document;
nativeTarget.__proto__ = { __proto__: nativeTarget.__proto__, addEventListener: (name, listener) => listener({ clientX: 1, clientY: 2 }) };
import * as React from "react";
export const Example = (props) => {
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  const handleMove = (event) => { setPosition({ x: event.clientX, y: event.clientY }); };
  function bindEvent(remove) {
    let method = "addEventListener";
    if (remove) method = "removeEventListener";
    document[method]("mousemove", handleMove, false);
  }
  React.useEffect(() => { bindEvent(); return () => bindEvent(true); }, []);
  React.useEffect(() => { props.onChange(position.x, position.y); }, [position]);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 26,
        line: 13,
        message:
          'Your parent re-renders on every local state change because this useEffect calls the prop "onChange" just to stay in sync.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "scalar-reflective-native-provider-replacement",
    code: `Reflect.set(EventTarget.prototype, "addEventListener", (name, listener) => listener({ clientX: 1, clientY: 2 }));
import * as React from "react";
export const Example = (props) => {
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  const handleMove = (event) => { setPosition({ x: event.clientX, y: event.clientY }); };
  function bindEvent(remove) {
    let method = "addEventListener";
    if (remove) method = "removeEventListener";
    document[method]("mousemove", handleMove, false);
  }
  React.useEffect(() => { bindEvent(); return () => bindEvent(true); }, []);
  React.useEffect(() => { props.onChange(position.x, position.y); }, [position]);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 26,
        line: 12,
        message:
          'Your parent re-renders on every local state change because this useEffect calls the prop "onChange" just to stay in sync.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "scalar-runtime-typescript-provider-replacement",
    code: `namespace NativeMutation { document.addEventListener = (name, listener) => listener({ clientX: 1, clientY: 2 }); }
import * as React from "react";
export const Example = (props) => {
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  const handleMove = (event) => { setPosition({ x: event.clientX, y: event.clientY }); };
  function bindEvent(remove) {
    let method = "addEventListener";
    if (remove) method = "removeEventListener";
    document[method]("mousemove", handleMove, false);
  }
  React.useEffect(() => { bindEvent(); return () => bindEvent(true); }, []);
  React.useEffect(() => { props.onChange(position.x, position.y); }, [position]);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 26,
        line: 12,
        message:
          'Your parent re-renders on every local state change because this useEffect calls the prop "onChange" just to stay in sync.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "scalar-nested-setter-function-transport",
    code: `import * as React from "react";
export const Example = (props) => {
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  const handleMove = (event) => { const later = () => { setPosition({ x: event.clientX, y: event.clientY }); }; props.capture(later); };
  function bindEvent(remove) {
    let method = "addEventListener";
    if (remove) method = "removeEventListener";
    document[method]("mousemove", handleMove, false);
  }
  React.useEffect(() => { bindEvent(); return () => bindEvent(true); }, []);
  React.useEffect(() => { props.onChange(position.x, position.y); }, [position]);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 26,
        line: 11,
        message:
          'Your parent re-renders on every local state change because this useEffect calls the prop "onChange" just to stay in sync.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "scalar-static-vm-provider-loader",
    code: `import * as runtime from "node:vm";
runtime.runInThisContext("document.addEventListener = (name, listener) => listener({clientX: 1, clientY: 2})");
import * as React from "react";
export const Example = (props) => {
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  const handleMove = (event) => { setPosition({ x: event.clientX, y: event.clientY }); };
  function bindEvent(remove) {
    let method = "addEventListener";
    if (remove) method = "removeEventListener";
    document[method]("mousemove", handleMove, false);
  }
  React.useEffect(() => { bindEvent(); return () => bindEvent(true); }, []);
  React.useEffect(() => { props.onChange(position.x, position.y); }, [position]);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 26,
        line: 13,
        message:
          'Your parent re-renders on every local state change because this useEffect calls the prop "onChange" just to stay in sync.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "scalar-state-snapshot-unknown-field-alias",
    code: `import * as React from "react";
export const Example = (props) => {
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  const handleMove = (event) => { setPosition({ x: props.point, y: event.clientY }); };
  function bindEvent(remove) {
    let method = "addEventListener";
    if (remove) method = "removeEventListener";
    document[method]("mousemove", handleMove, false);
  }
  React.useEffect(() => { bindEvent(); return () => bindEvent(true); }, []);
  React.useEffect(() => { props.onChange(position.x, position.y); }, [position]);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 26,
        line: 11,
        message:
          'Your parent re-renders on every local state change because this useEffect calls the prop "onChange" just to stay in sync.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "scalar-aliased-state-snapshot",
    code: `import * as React from "react";
export const Example = (props) => {
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  const handleMove = (event) => { const nextPosition = { x: event.clientX, y: event.clientY }; setPosition(nextPosition); };
  function bindEvent(remove) {
    let method = "addEventListener";
    if (remove) method = "removeEventListener";
    document[method]("mousemove", handleMove, false);
  }
  React.useEffect(() => { bindEvent(); return () => bindEvent(true); }, []);
  React.useEffect(() => { props.onChange(position.x, position.y); }, [position]);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 26,
        line: 11,
        message:
          'Your parent re-renders on every local state change because this useEffect calls the prop "onChange" just to stay in sync.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "scalar-spread-state-snapshot",
    code: `import * as React from "react";
export const Example = (props) => {
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  const handleMove = (event) => { setPosition({ ...props.position }); };
  function bindEvent(remove) {
    let method = "addEventListener";
    if (remove) method = "removeEventListener";
    document[method]("mousemove", handleMove, false);
  }
  React.useEffect(() => { bindEvent(); return () => bindEvent(true); }, []);
  React.useEffect(() => { props.onChange(position.x, position.y); }, [position]);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 26,
        line: 11,
        message:
          'Your parent re-renders on every local state change because this useEffect calls the prop "onChange" just to stay in sync.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "scalar-native-event-object-valued-field",
    code: `import * as React from "react";
export const Example = (props) => {
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  const handleMove = (event) => { setPosition({ x: event.target, y: event.clientY }); };
  function bindEvent(remove) {
    let method = "addEventListener";
    if (remove) method = "removeEventListener";
    document[method]("mousemove", handleMove, false);
  }
  React.useEffect(() => { bindEvent(); return () => bindEvent(true); }, []);
  React.useEffect(() => { props.onChange(position.x, position.y); }, [position]);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 26,
        line: 11,
        message:
          'Your parent re-renders on every local state change because this useEffect calls the prop "onChange" just to stay in sync.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "scalar-visible-global-window-namespace-replacement",
    code: `import * as React from "react";
globalThis.window = {
  addEventListener: (eventName, listener) => { listener({ clientX: 1, clientY: 2 }); },
  removeEventListener: () => {},
};
export const Example = (props) => {
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  const handleMove = (event) => { setPosition({ x: event.clientX, y: event.clientY }); };
  function bindEvent(remove) {
    let method = "addEventListener";
    if (remove) method = "removeEventListener";
    window[method]("mousemove", handleMove, false);
  }
  React.useEffect(() => { bindEvent(); return () => bindEvent(true); }, []);
  React.useEffect(() => { props.onChange(position.x, position.y); }, [position]);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 26,
        line: 15,
        message:
          'Your parent re-renders on every local state change because this useEffect calls the prop "onChange" just to stay in sync.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "scalar-named-function-listener-self-binding-transport",
    code: `import * as React from "react";
export const Example = (props) => {
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  let replay;
  const handleMove = function repeat(event) {
    replay = repeat;
    setPosition({ x: event.clientX, y: event.clientY });
  };
  function bindEvent(remove) {
    let method = "addEventListener";
    if (remove) method = "removeEventListener";
    document[method]("mousemove", handleMove, false);
  }
  React.useEffect(() => { bindEvent(); return () => bindEvent(true); }, []);
  React.useEffect(() => { props.onChange(position.x, position.y); }, [position]);
  return <button onClick={() => replay({ clientX: props.x, clientY: props.y })}>Replay</button>;
};
`,
    expectedDiagnostics: [
      {
        column: 26,
        line: 15,
        message:
          'Your parent re-renders on every local state change because this useEffect calls the prop "onChange" just to stay in sync.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "scalar-anonymous-listener-this-native-provider-write",
    code: `import * as React from "react";
export const Example = (props) => {
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  const handleMove = function(event) {
    this.addEventListener = (eventName, listener) => { listener({ clientX: props.x, clientY: props.y }); };
    setPosition({ x: event.clientX, y: event.clientY });
  };
  function bindEvent(remove) {
    let method = "addEventListener";
    if (remove) method = "removeEventListener";
    document[method]("mousemove", handleMove, false);
  }
  React.useEffect(() => { bindEvent(); return () => bindEvent(true); }, []);
  React.useEffect(() => { props.onChange(position.x, position.y); }, [position]);
  return <button onClick={() => bindEvent()}>Register</button>;
};
`,
    expectedDiagnostics: [
      {
        column: 26,
        line: 14,
        message:
          'Your parent re-renders on every local state change because this useEffect calls the prop "onChange" just to stay in sync.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "erased-native-document-interface",
    code: 'interface document {}\nimport * as React from "react";\nexport const Example = (props) => {\n  const [position, setPosition] = React.useState({ x: 0, y: 0 });\n  const handleMove = (event) => { setPosition({ x: event.clientX, y: event.clientY }); };\n  function bindEvent(remove) {\n    let method = "addEventListener";\n    if (remove) method = "removeEventListener";\n    document[method]("mousemove", handleMove, false);\n  }\n  React.useEffect(() => { bindEvent(); return () => bindEvent(true); }, []);\n  React.useEffect(() => { props.onChange(position.x, position.y); }, [position]);\n  return null;\n};\n',
    expectedDiagnostics: [],
  },
  {
    name: "erased-handler-local-setter-interface",
    code: 'import * as React from "react";\nexport const Example = (props) => {\n  const [position, setPosition] = React.useState({ x: 0, y: 0 });\n  const handleMove = (event) => { interface setPosition {} setPosition({ x: event.clientX, y: event.clientY }); };\n  function bindEvent(remove) {\n    let method = "addEventListener";\n    if (remove) method = "removeEventListener";\n    document[method]("mousemove", handleMove, false);\n  }\n  React.useEffect(() => { bindEvent(); return () => bindEvent(true); }, []);\n  React.useEffect(() => { props.onChange(position.x, position.y); }, [position]);\n  return null;\n};\n',
    expectedDiagnostics: [],
  },
  {
    name: "erased-react-interface-keeps-extra-react-writer",
    code: 'import * as React from "react";\nexport const Example = (props) => {\n  interface React {}\n  const [position, setPosition] = React.useState({ x: 0, y: 0 });\n  const handleMove = (event) => { setPosition({ x: event.clientX, y: event.clientY }); };\n  function bindEvent(remove) {\n    let method = "addEventListener";\n    if (remove) method = "removeEventListener";\n    document[method]("mousemove", handleMove, false);\n  }\n  React.useEffect(() => { bindEvent(); return () => bindEvent(true); }, []);\n  React.useEffect(() => { props.onChange(position.x, position.y); }, [position]);\n  return <button onClick={() => setPosition({ x: 1, y: 2 })}>Write</button>;\n};\n',
    expectedDiagnostics: [
      {
        column: 26,
        line: 12,
        message:
          'Your parent re-renders on every local state change because this useEffect calls the prop "onChange" just to stay in sync.',
        nodeType: "CallExpression",
      },
    ],
  },
];

describe("no-prop-callback-in-effect finite native listener state", () => {
  it.each(nativeListenerStateCases)("$name", ({ code, expectedDiagnostics }) => {
    const result = runRule(noPropCallbackInEffect, code, nativeListenerStateOptions);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual(expectedDiagnostics);
  });
});
