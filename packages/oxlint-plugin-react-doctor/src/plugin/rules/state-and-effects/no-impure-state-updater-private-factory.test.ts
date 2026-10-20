import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import type { RunRuleOptions } from "../../../test-utils/run-rule.js";
import type { Rule } from "../../utils/rule.js";
import { noImpureStateUpdater } from "./no-impure-state-updater.js";
import { getPrivateFactoryNativeStateSetter } from "./utils/get-private-factory-native-state-setter.js";

interface FactoryCase {
  name: string;
  code: string;
  options: RunRuleOptions;
}

const certifiedFactoryCalls: Rule = {
  ...noImpureStateUpdater,
  create: (context) => ({
    CallExpression: (node) => {
      if (getPrivateFactoryNativeStateSetter(node.callee, context)) {
        context.report({ node, message: "Certified private factory setter" });
      }
    },
  }),
};

const impureFactoryCases: FactoryCase[] = [
  {
    name: "private factory captures an outer scalar",
    code: `import { useState } from "react";
let observed = 0;
const createHandlers = (applyState, configuration) => ({
  onClick: () => applyState((previous) => {
    observed = previous;
    return previous;
  }),
});
export const Counter = (props) => {
  const [count, setCount] = useState(0);
  return <button {...createHandlers(setCount, props.config)}>{count}</button>;
};`,
    options: { filename: "private-factory-state-setter.tsx" },
  },
  {
    name: "private factory captures an outer object field",
    code: `import { useState } from "react";
const observed = { current: 0 };
const createHandlers = (applyState, configuration) => ({
  onClick: () => applyState((previous) => {
    observed.current = previous;
    return previous;
  }),
});
export const Counter = (props) => {
  const [count, setCount] = useState(0);
  return <button {...createHandlers(setCount, props.config)}>{count}</button>;
};`,
    options: { filename: "private-factory-state-setter.tsx" },
  },
  {
    name: "native setter has another readonly RHS escape",
    code: `import { useState } from "react";
let observed = 0;
const createHandlers = (applyState, configuration) => ({
  onClick: () => applyState((previous) => {
    observed = previous;
    return previous;
  }),
});
export const Counter = (props) => {
  const [count, setCount] = useState(0);
  props.registered.setter = setCount;
  return <button {...createHandlers(setCount, props.config)}>{count}</button>;
};`,
    options: { filename: "private-factory-state-setter.tsx" },
  },
  {
    name: "renamed React import preserves native identity",
    code: `import { useState as useCounterState } from "react";
let observed = 0;
const createHandlers = (applyState, configuration) => ({
  onClick: () => applyState((previous) => {
    observed = previous;
    return previous;
  }),
});
export const Counter = (props) => {
  const [count, setCount] = useCounterState(0);
  return <button {...createHandlers(setCount, props.config)}>{count}</button>;
};`,
    options: { filename: "private-factory-state-setter.tsx" },
  },
  {
    name: "type-only factory query remains compatible",
    code: `import { useState } from "react";
let observed = 0;
const createHandlers = (applyState, configuration) => ({
  onClick: () => applyState((previous) => {
    observed = previous;
    return previous;
  }),
});
type HandlerFactory = typeof createHandlers;
export const Counter = (props) => {
  const [count, setCount] = useState(0);
  return <button {...createHandlers(setCount, props.config)}>{count}</button>;
};`,
    options: { filename: "private-factory-state-setter.tsx" },
  },
  {
    name: "plain native namespace React call remains compatible",
    code: `import * as React from "react";
let observed = 0;
const createHandlers = (applyState, configuration) => ({
  onClick: () => applyState((previous) => {
    observed = previous;
    return previous;
  }),
});
export const Counter = (props) => {
  const [count, setCount] = React.useState(0);
  return <button {...createHandlers(setCount, props.config)}>{count}</button>;
};`,
    options: { filename: "private-factory-state-setter.tsx" },
  },
  {
    name: "erased-react-interface",
    code: 'import * as React from "react";\ninterface React {}\n\nlet observed = 0;\nconst createHandlers = (applyState, configuration) => ({\n  onClick: () => applyState((previous) => {\n    observed = previous;\n    return previous;\n  }),\n});\nexport const Counter = (props) => {\n  const [count, setCount] = React.useState(0);\n  return <button {...createHandlers(setCount, props.config)}>{count}</button>;\n};',
    options: {
      filename: "private-factory-state-setter.tsx",
    },
  },
  {
    name: "ordinary-global-react",
    code: "\n\nlet observed = 0;\nconst createHandlers = (applyState, configuration) => ({\n  onClick: () => applyState((previous) => {\n    observed = previous;\n    return previous;\n  }),\n});\nexport const Counter = (props) => {\n  const [count, setCount] = React.useState(0);\n  return <button {...createHandlers(setCount, props.config)}>{count}</button>;\n};",
    options: {
      filename: "private-factory-state-setter.tsx",
    },
  },
];

const safeFactoryCases: FactoryCase[] = [
  {
    name: "pure updater remains quiet",
    code: `import { useState } from "react";
let observed = 0;
const createHandlers = (applyState, configuration) => ({
  onClick: () => applyState((previous) => {
    return previous;
  }),
});
export const Counter = (props) => {
  const [count, setCount] = useState(0);
  return <button {...createHandlers(setCount, props.config)}>{count}</button>;
};`,
    options: { filename: "private-factory-state-setter.tsx" },
  },
  {
    name: "fresh updater-local mutation remains quiet",
    code: `import { useState } from "react";
let observed = 0;
const createHandlers = (applyState, configuration) => ({
  onClick: () => applyState((previous) => {
    const result = { value: previous };
    result.value += 1;
    return previous;
  }),
});
export const Counter = (props) => {
  const [count, setCount] = useState(0);
  return <button {...createHandlers(setCount, props.config)}>{count}</button>;
};`,
    options: { filename: "private-factory-state-setter.tsx" },
  },
  {
    name: "ordinary synchronous invoker is not a state setter",
    code: `import { useState } from "react";
let observed = 0;
const createHandlers = (applyState, configuration) => ({
  onClick: () => applyState((previous) => {
    observed = previous;
    return previous;
  }),
});
export const Counter = (props) => {
  const [count, setCount] = useState(0);
  return <button {...createHandlers((callback) => callback(count), props.config)}>{count}</button>;
};`,
    options: { filename: "private-factory-state-setter.tsx" },
  },
  {
    name: "shadowed fake React hook is not a native setter",
    code: `const useState = (initial) => [initial, (callback) => callback(initial)];
let observed = 0;
const createHandlers = (applyState, configuration) => ({
  onClick: () => applyState((previous) => {
    observed = previous;
    return previous;
  }),
});
export const Counter = (props) => {
  const [count, setCount] = useState(0);
  return <button {...createHandlers(setCount, props.config)}>{count}</button>;
};`,
    options: { filename: "private-factory-state-setter.tsx" },
  },
  {
    name: "namespace-provider-replaced",
    code: 'import * as React from "react";\nReact.useState = initial => [initial, callback => callback(initial)];\n\nlet observed = 0;\nconst createHandlers = (applyState, configuration) => ({\n  onClick: () => applyState((previous) => {\n    observed = previous;\n    return previous;\n  }),\n});\nexport const Counter = (props) => {\n  const [count, setCount] = React.useState(0);\n  return <button {...createHandlers(setCount, props.config)}>{count}</button>;\n};',
    options: {
      filename: "private-factory-state-setter.tsx",
    },
  },
  {
    name: "namespace-provider-escaped",
    code: 'import * as React from "react";\nconst runtime = React; runtime.useState = initial => [initial, callback => callback(initial)];\n\nlet observed = 0;\nconst createHandlers = (applyState, configuration) => ({\n  onClick: () => applyState((previous) => {\n    observed = previous;\n    return previous;\n  }),\n});\nexport const Counter = (props) => {\n  const [count, setCount] = React.useState(0);\n  return <button {...createHandlers(setCount, props.config)}>{count}</button>;\n};',
    options: {
      filename: "private-factory-state-setter.tsx",
    },
  },
  {
    name: "default-namespace-provider-replaced",
    code: 'import React from "react";\nReact.useState = initial => [initial, callback => callback(initial)];\n\nlet observed = 0;\nconst createHandlers = (applyState, configuration) => ({\n  onClick: () => applyState((previous) => {\n    observed = previous;\n    return previous;\n  }),\n});\nexport const Counter = (props) => {\n  const [count, setCount] = React.useState(0);\n  return <button {...createHandlers(setCount, props.config)}>{count}</button>;\n};',
    options: {
      filename: "private-factory-state-setter.tsx",
    },
  },
  {
    name: "default-namespace-provider-escaped",
    code: 'import React from "react";\nconst runtime = React; runtime.useState = initial => [initial, callback => callback(initial)];\n\nlet observed = 0;\nconst createHandlers = (applyState, configuration) => ({\n  onClick: () => applyState((previous) => {\n    observed = previous;\n    return previous;\n  }),\n});\nexport const Counter = (props) => {\n  const [count, setCount] = React.useState(0);\n  return <button {...createHandlers(setCount, props.config)}>{count}</button>;\n};',
    options: {
      filename: "private-factory-state-setter.tsx",
    },
  },
  {
    name: "type-only namespace cannot provide native setter",
    code: 'import type * as React from "react";\n\nlet observed = 0;\nconst createHandlers = (applyState, configuration) => ({\n  onClick: () => applyState((previous) => {\n    observed = previous;\n    return previous;\n  }),\n});\nexport const Counter = (props) => {\n  const [count, setCount] = React.useState(0);\n  return <button {...createHandlers(setCount, props.config)}>{count}</button>;\n};',
    options: {
      filename: "private-factory-state-setter.tsx",
    },
  },
  {
    name: "type-only default cannot provide native setter",
    code: 'import type React from "react";\n\nlet observed = 0;\nconst createHandlers = (applyState, configuration) => ({\n  onClick: () => applyState((previous) => {\n    observed = previous;\n    return previous;\n  }),\n});\nexport const Counter = (props) => {\n  const [count, setCount] = React.useState(0);\n  return <button {...createHandlers(setCount, props.config)}>{count}</button>;\n};',
    options: {
      filename: "private-factory-state-setter.tsx",
    },
  },
  {
    name: "type-only named import cannot provide native setter",
    code: 'import { type useState } from "react";\n\nlet observed = 0;\nconst createHandlers = (applyState, configuration) => ({\n  onClick: () => applyState((previous) => {\n    observed = previous;\n    return previous;\n  }),\n});\nexport const Counter = (props) => {\n  const [count, setCount] = useState(0);\n  return <button {...createHandlers(setCount, props.config)}>{count}</button>;\n};',
    options: {
      filename: "private-factory-state-setter.tsx",
    },
  },
  {
    name: "assigned-global-react",
    code: "const fakeReact = { useState: initial => [initial, callback => callback(initial)] }; Object.assign(globalThis, { React: fakeReact });\n\n\nlet observed = 0;\nconst createHandlers = (applyState, configuration) => ({\n  onClick: () => applyState((previous) => {\n    observed = previous;\n    return previous;\n  }),\n});\nexport const Counter = (props) => {\n  const [count, setCount] = React.useState(0);\n  return <button {...createHandlers(setCount, props.config)}>{count}</button>;\n};",
    options: {
      filename: "private-factory-state-setter.tsx",
    },
  },
  {
    name: "aliased-global-react",
    code: "const runtime = globalThis; runtime.React = { useState: initial => [initial, callback => callback(initial)] };\n\n\nlet observed = 0;\nconst createHandlers = (applyState, configuration) => ({\n  onClick: () => applyState((previous) => {\n    observed = previous;\n    return previous;\n  }),\n});\nexport const Counter = (props) => {\n  const [count, setCount] = React.useState(0);\n  return <button {...createHandlers(setCount, props.config)}>{count}</button>;\n};",
    options: {
      filename: "private-factory-state-setter.tsx",
    },
  },
];

const unsupportedFactoryCases: FactoryCase[] = [
  {
    name: "two factory call sites decline the certificate",
    code: `import { useState } from "react";
let observed = 0;
const createHandlers = (applyState, configuration) => ({
  onClick: () => applyState((previous) => {
    observed = previous;
    return previous;
  }),
});
export const Counter = (props) => {
  const [count, setCount] = useState(0);
  createHandlers((callback) => callback(count), props.config);
  return <button {...createHandlers(setCount, props.config)}>{count}</button>;
};`,
    options: { filename: "private-factory-state-setter.tsx" },
  },
  {
    name: "exported factory declines the certificate",
    code: `import { useState } from "react";
let observed = 0;
export const createHandlers = (applyState, configuration) => ({
  onClick: () => applyState((previous) => {
    observed = previous;
    return previous;
  }),
});
export const Counter = (props) => {
  const [count, setCount] = useState(0);
  return <button {...createHandlers(setCount, props.config)}>{count}</button>;
};`,
    options: { filename: "private-factory-state-setter.tsx" },
  },
  {
    name: "factory RHS escape declines the certificate",
    code: `import { useState } from "react";
let observed = 0;
const createHandlers = (applyState, configuration) => ({
  onClick: () => applyState((previous) => {
    observed = previous;
    return previous;
  }),
});
register(createHandlers);
export const Counter = (props) => {
  const [count, setCount] = useState(0);
  return <button {...createHandlers(setCount, props.config)}>{count}</button>;
};`,
    options: { filename: "private-factory-state-setter.tsx" },
  },
  {
    name: "factory alias declines the certificate",
    code: `import { useState } from "react";
let observed = 0;
const createHandlers = (applyState, configuration) => ({
  onClick: () => applyState((previous) => {
    observed = previous;
    return previous;
  }),
});
const alias = createHandlers;
export const Counter = (props) => {
  const [count, setCount] = useState(0);
  return <button {...alias(setCount, props.config)}>{count}</button>;
};`,
    options: { filename: "private-factory-state-setter.tsx" },
  },
  {
    name: "recursive factory declines the certificate",
    code: `import { useState } from "react";
let observed = 0;
const createHandlers = (applyState, configuration) => ({
  onClick: () => { createHandlers(applyState, configuration); return applyState((previous) => {
    observed = previous;
    return previous;
  }); },
});
export const Counter = (props) => {
  const [count, setCount] = useState(0);
  return <button {...createHandlers(setCount, props.config)}>{count}</button>;
};`,
    options: { filename: "private-factory-state-setter.tsx" },
  },
  {
    name: "default parameter declines the certificate",
    code: `import { useState } from "react";
let observed = 0;
const createHandlers = (applyState = (callback) => callback(0), configuration) => ({
  onClick: () => applyState((previous) => {
    observed = previous;
    return previous;
  }),
});
export const Counter = (props) => {
  const [count, setCount] = useState(0);
  return <button {...createHandlers(setCount, props.config)}>{count}</button>;
};`,
    options: { filename: "private-factory-state-setter.tsx" },
  },
  {
    name: "rest parameter declines the certificate",
    code: `import { useState } from "react";
let observed = 0;
const createHandlers = (applyState, ...configuration) => ({
  onClick: () => applyState((previous) => {
    observed = previous;
    return previous;
  }),
});
export const Counter = (props) => {
  const [count, setCount] = useState(0);
  return <button {...createHandlers(setCount, props.config)}>{count}</button>;
};`,
    options: { filename: "private-factory-state-setter.tsx" },
  },
  {
    name: "destructured parameter declines the certificate",
    code: `import { useState } from "react";
let observed = 0;
const createHandlers = ({ applyState }, configuration) => ({
  onClick: () => applyState((previous) => {
    observed = previous;
    return previous;
  }),
});
export const Counter = (props) => {
  const [count, setCount] = useState(0);
  return <button {...createHandlers({ applyState: setCount }, props.config)}>{count}</button>;
};`,
    options: { filename: "private-factory-state-setter.tsx" },
  },
  {
    name: "spread factory argument declines the certificate",
    code: `import { useState } from "react";
let observed = 0;
const createHandlers = (applyState, configuration) => ({
  onClick: () => applyState((previous) => {
    observed = previous;
    return previous;
  }),
});
export const Counter = (props) => {
  const [count, setCount] = useState(0);
  return <button {...createHandlers(...[setCount, props.config])}>{count}</button>;
};`,
    options: { filename: "private-factory-state-setter.tsx" },
  },
  {
    name: "optional factory call declines the certificate",
    code: `import { useState } from "react";
let observed = 0;
const createHandlers = (applyState, configuration) => ({
  onClick: () => applyState((previous) => {
    observed = previous;
    return previous;
  }),
});
export const Counter = (props) => {
  const [count, setCount] = useState(0);
  return <button {...createHandlers?.(setCount, props.config)}>{count}</button>;
};`,
    options: { filename: "private-factory-state-setter.tsx" },
  },
  {
    name: "member factory call declines the certificate",
    code: `import { useState } from "react";
let observed = 0;
const createHandlers = (applyState, configuration) => ({
  onClick: () => applyState((previous) => {
    observed = previous;
    return previous;
  }),
});
const holder = { createHandlers };
export const Counter = (props) => {
  const [count, setCount] = useState(0);
  return <button {...holder.createHandlers(setCount, props.config)}>{count}</button>;
};`,
    options: { filename: "private-factory-state-setter.tsx" },
  },
  {
    name: "selected parameter alias declines the certificate",
    code: `import { useState } from "react";
let observed = 0;
const createHandlers = (applyState, configuration) => { const alias = applyState; return ({
  onClick: () => alias((previous) => {
    observed = previous;
    return previous;
  }),
}); };
export const Counter = (props) => {
  const [count, setCount] = useState(0);
  return <button {...createHandlers(setCount, props.config)}>{count}</button>;
};`,
    options: { filename: "private-factory-state-setter.tsx" },
  },
  {
    name: "selected parameter return escape declines the certificate",
    code: `import { useState } from "react";
let observed = 0;
const createHandlers = (applyState, configuration) => ({
  setter: applyState,
  onClick: () => applyState((previous) => {
    observed = previous;
    return previous;
  }),
});
export const Counter = (props) => {
  const [count, setCount] = useState(0);
  return <button {...createHandlers(setCount, props.config)}>{count}</button>;
};`,
    options: { filename: "private-factory-state-setter.tsx" },
  },
  {
    name: "selected parameter write declines the certificate",
    code: `import { useState } from "react";
let observed = 0;
const createHandlers = (applyState, configuration) => { applyState = (callback) => callback(0); return ({
  onClick: () => applyState((previous) => {
    observed = previous;
    return previous;
  }),
}); };
export const Counter = (props) => {
  const [count, setCount] = useState(0);
  return <button {...createHandlers(setCount, props.config)}>{count}</button>;
};`,
    options: { filename: "private-factory-state-setter.tsx" },
  },
  {
    name: "selected parameter forwarded as an argument declines the certificate",
    code: `import { useState } from "react";
let observed = 0;
const createHandlers = (applyState, configuration) => ({
  onSetup: () => register(applyState),
  onClick: () => applyState((previous) => {
    observed = previous;
    return previous;
  }),
});
export const Counter = (props) => {
  const [count, setCount] = useState(0);
  return <button {...createHandlers(setCount, props.config)}>{count}</button>;
};`,
    options: { filename: "private-factory-state-setter.tsx" },
  },
  {
    name: "native setter reassignment declines the certificate",
    code: `import { useState } from "react";
let observed = 0;
const createHandlers = (applyState, configuration) => ({
  onClick: () => applyState((previous) => {
    observed = previous;
    return previous;
  }),
});
export const Counter = (props) => {
  let [count, setCount] = useState(0);
  setCount = (callback) => callback(count);
  return <button {...createHandlers(setCount, props.config)}>{count}</button>;
};`,
    options: { filename: "private-factory-state-setter.tsx" },
  },
  {
    name: "direct eval declines the certificate",
    code: `import { useState } from "react";
let observed = 0;
const createHandlers = (applyState, configuration) => ({
  onSetup: () => eval("applyState = callback => callback(0)"),
  onClick: () => applyState((previous) => {
    observed = previous;
    return previous;
  }),
});
export const Counter = (props) => {
  const [count, setCount] = useState(0);
  return <button {...createHandlers(setCount, props.config)}>{count}</button>;
};`,
    options: { filename: "private-factory-state-setter.tsx" },
  },
  {
    name: "arguments capability declines the certificate",
    code: `import { useState } from "react";
let observed = 0;
const createHandlers = (applyState, configuration) => ({
  onSetup: () => arguments[0],
  onClick: () => applyState((previous) => {
    observed = previous;
    return previous;
  }),
});
export const Counter = (props) => {
  const [count, setCount] = useState(0);
  return <button {...createHandlers(setCount, props.config)}>{count}</button>;
};`,
    options: { filename: "private-factory-state-setter.tsx" },
  },
  {
    name: "runtime enum initializer declines the certificate",
    code: `import { useState } from "react";
let observed = 0;
const createHandlers = (applyState, configuration) => ({
  onClick: () => { enum Poison { Value = (applyState = (callback) => callback(0)) as any }; return applyState((previous) => {
    observed = previous;
    return previous;
  }); },
});
export const Counter = (props) => {
  const [count, setCount] = useState(0);
  return <button {...createHandlers(setCount, props.config)}>{count}</button>;
};`,
    options: { filename: "private-factory-state-setter.tsx" },
  },
  {
    name: "runtime parameter property initializer declines the certificate",
    code: `import { useState } from "react";
let observed = 0;
const createHandlers = (applyState, configuration) => ({
  onClick: () => { class Setup { constructor(public value = (applyState = (callback) => callback(0))) {} }; new Setup(); return applyState((previous) => {
    observed = previous;
    return previous;
  }); },
});
export const Counter = (props) => {
  const [count, setCount] = useState(0);
  return <button {...createHandlers(setCount, props.config)}>{count}</button>;
};`,
    options: { filename: "private-factory-state-setter.tsx" },
  },
  {
    name: "computed catch binding write declines the certificate",
    code: `import { useState } from "react";
let observed = 0;
const createHandlers = (applyState, configuration) => ({
  onClick: () => { try { throw {}; } catch ({[(applyState = (callback) => callback(0), "value")]: ignored}) {} return applyState((previous) => {
    observed = previous;
    return previous;
  }); },
});
export const Counter = (props) => {
  const [count, setCount] = useState(0);
  return <button {...createHandlers(setCount, props.config)}>{count}</button>;
};`,
    options: { filename: "private-factory-state-setter.tsx" },
  },
  {
    name: "late argument call declines the certificate",
    code: `import { useState } from "react";
let observed = 0;
const createHandlers = (applyState, configuration) => ({
  onClick: () => applyState((previous) => {
    observed = previous;
    return previous;
  }),
});
export const Counter = (props) => {
  const [count, setCount] = useState(0);
  return <button {...createHandlers(setCount, replaceSetter())}>{count}</button>;
};`,
    options: { filename: "private-factory-state-setter.tsx" },
  },
  {
    name: "late argument assignment declines the certificate",
    code: `import { useState } from "react";
let observed = 0;
const createHandlers = (applyState, configuration) => ({
  onClick: () => applyState((previous) => {
    observed = previous;
    return previous;
  }),
});
export const Counter = (props) => {
  const [count, setCount] = useState(0);
  return <button {...createHandlers(setCount, (props.config = {}))}>{count}</button>;
};`,
    options: { filename: "private-factory-state-setter.tsx" },
  },
  {
    name: "async factory declines the certificate",
    code: `import { useState } from "react";
let observed = 0;
const createHandlers = async (applyState, configuration) => ({
  onClick: () => applyState((previous) => {
    observed = previous;
    return previous;
  }),
});
export const Counter = (props) => {
  const [count, setCount] = useState(0);
  return <button {...createHandlers(setCount, props.config)}>{count}</button>;
};`,
    options: { filename: "private-factory-state-setter.tsx" },
  },
  {
    name: "non-first parameter declines the certificate",
    code: `import { useState } from "react";
let observed = 0;
const createHandlers = (configuration, applyState) => ({
  onClick: () => applyState((previous) => {
    observed = previous;
    return previous;
  }),
});
export const Counter = (props) => {
  const [count, setCount] = useState(0);
  return <button {...createHandlers(props.config, setCount)}>{count}</button>;
};`,
    options: { filename: "private-factory-state-setter.tsx" },
  },
  {
    name: "literal dead factory invocation declines the certificate",
    code: `import { useState } from "react";
let observed = 0;
const createHandlers = (applyState, configuration) => ({
  onClick: () => applyState((previous) => {
    observed = previous;
    return previous;
  }),
});
export const Counter = (props) => {
  const [count, setCount] = useState(0);
  return <button {...(false ? createHandlers(setCount, props.config) : {})}>{count}</button>;
};`,
    options: { filename: "private-factory-state-setter.tsx" },
  },
  {
    name: "selected parameter call spread declines the certificate",
    code: `import { useState } from "react";
let observed = 0;
const createHandlers = (applyState, configuration) => ({
  onClick: () => applyState(...[(previous) => {
    observed = previous;
    return previous;
  }]),
});
export const Counter = (props) => {
  const [count, setCount] = useState(0);
  return <button {...createHandlers(setCount, props.config)}>{count}</button>;
};`,
    options: { filename: "private-factory-state-setter.tsx" },
  },
  {
    name: "transparent TypeScript direct eval declines the certificate",
    code: `import { useState } from "react";
let observed = 0;
const makeHandler = (setValue) => {
  (eval as any)("setValue = updater => updater(0)");
  return () => setValue((previous) => {
    observed += 1;
    return previous;
  });
};
export const Example = () => {
  const [value, setValue] = useState(0);
  const onClick = makeHandler(setValue);
  return <button onClick={onClick}>{value}:{observed}</button>;
};
`,
    options: { filename: "synthetic-private-factory-eval-wrapper.tsx", includeLocations: true },
  },
];

describe("private factory native state setter provenance", () => {
  it.each(impureFactoryCases)("reports $name", ({ code, options }) => {
    expect(runRule(noImpureStateUpdater, code, options)).toEqual({
      diagnostics: [
        {
          message:
            'This state updater performs the captured value "observed". React may run updater functions more than once, so side effects here can repeat or observe inconsistent external state.',
          nodeType: "ArrowFunctionExpression",
        },
      ],
      parseErrors: [],
    });
  });

  it.each(safeFactoryCases)("preserves $name", ({ code, options }) => {
    expect(runRule(noImpureStateUpdater, code, options)).toEqual({
      diagnostics: [],
      parseErrors: [],
    });
  });

  it.each(unsupportedFactoryCases)("declines $name", ({ code, options }) => {
    expect(runRule(certifiedFactoryCalls, code, options)).toEqual({
      diagnostics: [],
      parseErrors: [],
    });
  });
});
