import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import type { RuleDiagnostic, RunRuleOptions } from "../../../test-utils/run-rule.js";
import { noPromiseThenSideEffectInEffectWithoutCatch } from "./no-promise-then-side-effect-in-effect-without-catch.js";

interface ImmediateIifeControl {
  name: string;
  code: string;
  expectedDiagnostics: RuleDiagnostic[];
}

const IMMEDIATE_IIFE_MESSAGE =
  "This promise chain runs inside an immediately invoked function in an effect and sets state or mutates a ref without handling rejection. Add a rejection handler to this chain; an outer try/catch or promise catch does not handle a discarded inner chain.";

const RUN_RULE_OPTIONS: RunRuleOptions = {
  filename: "synthetic-immediate-iife-floating-then.tsx",
  includeLocations: true,
  settings: {
    "react-doctor": {
      portedRuleMode: "curated",
      capabilities: ["react"],
    },
  },
};

const CONTROLS: ImmediateIifeControl[] = [
  {
    name: "direct-async-marker-without-suspension",
    code: `import { useEffect, useLayoutEffect, useState, useRef } from "react";
export const Example = () => {
  const [value, setValue] = useState(null);
  const valueRef = useRef<unknown>(null);
  useEffect(() => {
    (async () => {
      fetch("/value").then((response) => response.json()).then(setValue);
    })();
  }, []);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 6,
        line: 7,
        message: IMMEDIATE_IIFE_MESSAGE,
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "direct-synchronous-function-expression",
    code: `import { useEffect, useLayoutEffect, useState, useRef } from "react";
export const Example = () => {
  const [value, setValue] = useState(null);
  const valueRef = useRef<unknown>(null);
  useEffect(() => {
    (function () {
      fetch("/value").then((response) => response.json()).then(setValue);
    })();
  }, []);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 6,
        line: 7,
        message: IMMEDIATE_IIFE_MESSAGE,
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "void-discarded-chain",
    code: `import { useEffect, useLayoutEffect, useState, useRef } from "react";
export const Example = () => {
  const [value, setValue] = useState(null);
  const valueRef = useRef<unknown>(null);
  useEffect(() => {
    (() => {
      void fetch("/value").then((response) => response.json()).then(setValue);
    })();
  }, []);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 11,
        line: 7,
        message: IMMEDIATE_IIFE_MESSAGE,
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "outer-iife-catch-does-not-own-inner-chain",
    code: `import { useEffect, useLayoutEffect, useState, useRef } from "react";
export const Example = () => {
  const [value, setValue] = useState(null);
  const valueRef = useRef<unknown>(null);
  useEffect(() => {
    (async () => {
      fetch("/value").then((response) => response.json()).then(setValue);
    })().catch(() => {});
  }, []);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 6,
        line: 7,
        message: IMMEDIATE_IIFE_MESSAGE,
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "synchronous-try-does-not-own-future-rejection",
    code: `import { useEffect, useLayoutEffect, useState, useRef } from "react";
export const Example = () => {
  const [value, setValue] = useState(null);
  const valueRef = useRef<unknown>(null);
  useEffect(() => {
    try {
      (() => { fetch("/value").then((response) => response.json()).then(setValue); })();
    } catch {}
  }, []);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 15,
        line: 7,
        message: IMMEDIATE_IIFE_MESSAGE,
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "layout-effect-actual-ref-write",
    code: `import { useEffect, useLayoutEffect, useState, useRef } from "react";
export const Example = () => {
  const [value, setValue] = useState(null);
  const valueRef = useRef<unknown>(null);
  useLayoutEffect(() => {
    (() => {
      fetch("/value").then((response) => { valueRef.current = response; });
    })();
  }, []);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 6,
        line: 7,
        message: IMMEDIATE_IIFE_MESSAGE,
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "inner-terminal-catch",
    code: `import { useEffect, useLayoutEffect, useState, useRef } from "react";
export const Example = () => {
  const [value, setValue] = useState(null);
  const valueRef = useRef<unknown>(null);
  useEffect(() => {
    (() => { fetch("/value").then((response) => response.json()).then(setValue).catch(() => {}); })();
  }, []);
  return null;
};
`,
    expectedDiagnostics: [],
  },
  {
    name: "inner-then-rejection-handler",
    code: `import { useEffect, useLayoutEffect, useState, useRef } from "react";
export const Example = () => {
  const [value, setValue] = useState(null);
  const valueRef = useRef<unknown>(null);
  useEffect(() => {
    (() => { fetch("/value").then(setValue, () => {}); })();
  }, []);
  return null;
};
`,
    expectedDiagnostics: [],
  },
  {
    name: "returned-inner-chain",
    code: `import { useEffect, useLayoutEffect, useState, useRef } from "react";
export const Example = () => {
  const [value, setValue] = useState(null);
  const valueRef = useRef<unknown>(null);
  useEffect(() => {
    (async () => { return fetch("/value").then((response) => response.json()).then(setValue); })().catch(() => {});
  }, []);
  return null;
};
`,
    expectedDiagnostics: [],
  },
  {
    name: "awaited-inner-chain",
    code: `import { useEffect, useLayoutEffect, useState, useRef } from "react";
export const Example = () => {
  const [value, setValue] = useState(null);
  const valueRef = useRef<unknown>(null);
  useEffect(() => {
    (async () => { await fetch("/value").then((response) => response.json()).then(setValue); })().catch(() => {});
  }, []);
  return null;
};
`,
    expectedDiagnostics: [],
  },
  {
    name: "variable-bound-inner-chain",
    code: `import { useEffect, useLayoutEffect, useState, useRef } from "react";
export const Example = () => {
  const [value, setValue] = useState(null);
  const valueRef = useRef<unknown>(null);
  useEffect(() => {
    (() => { const pending = fetch("/value").then((response) => response.json()).then(setValue); pending.catch(() => {}); })();
  }, []);
  return null;
};
`,
    expectedDiagnostics: [],
  },
  {
    name: "nested-iife-second-invocation-layer",
    code: `import { useEffect, useLayoutEffect, useState, useRef } from "react";
export const Example = () => {
  const [value, setValue] = useState(null);
  const valueRef = useRef<unknown>(null);
  useEffect(() => {
    (() => { (() => { fetch("/value").then((response) => response.json()).then(setValue); })(); })();
  }, []);
  return null;
};
`,
    expectedDiagnostics: [],
  },
  {
    name: "named-local-helper",
    code: `import { useEffect, useLayoutEffect, useState, useRef } from "react";
export const Example = () => {
  const [value, setValue] = useState(null);
  const valueRef = useRef<unknown>(null);
  useEffect(() => {
    const run = () => { fetch("/value").then((response) => response.json()).then(setValue); };
    run();
  }, []);
  return null;
};
`,
    expectedDiagnostics: [],
  },
  {
    name: "deferred-timer-callback",
    code: `import { useEffect, useLayoutEffect, useState, useRef } from "react";
export const Example = () => {
  const [value, setValue] = useState(null);
  const valueRef = useRef<unknown>(null);
  useEffect(() => {
    setTimeout(() => { fetch("/value").then((response) => response.json()).then(setValue); }, 0);
  }, []);
  return null;
};
`,
    expectedDiagnostics: [],
  },
  {
    name: "generator-iife",
    code: `import { useEffect, useLayoutEffect, useState, useRef } from "react";
export const Example = () => {
  const [value, setValue] = useState(null);
  const valueRef = useRef<unknown>(null);
  useEffect(() => {
    (function* () { fetch("/value").then((response) => response.json()).then(setValue); })();
  }, []);
  return null;
};
`,
    expectedDiagnostics: [],
  },
  {
    name: "parameterized-iife",
    code: `import { useEffect, useLayoutEffect, useState, useRef } from "react";
export const Example = () => {
  const [value, setValue] = useState(null);
  const valueRef = useRef<unknown>(null);
  useEffect(() => {
    ((unused) => { fetch("/value").then((response) => response.json()).then(setValue); })(undefined);
  }, []);
  return null;
};
`,
    expectedDiagnostics: [],
  },
  {
    name: "async-effect-callback",
    code: `import { useEffect, useLayoutEffect, useState, useRef } from "react";
export const Example = () => {
  const [value, setValue] = useState(null);
  const valueRef = useRef<unknown>(null);
  useEffect(async () => {
    (() => { fetch("/value").then((response) => response.json()).then(setValue); })();
  }, []);
  return null;
};
`,
    expectedDiagnostics: [],
  },
  {
    name: "type-only-effect-import",
    code: `import type { useEffect } from "react";
import { useState, useRef } from "react";
export const Example = () => {
  const [value, setValue] = useState(null);
  const valueRef = useRef<unknown>(null);
  useEffect(() => {
    (() => { fetch("/value").then((response) => response.json()).then(setValue); })();
  }, []);
  return null;
};
`,
    expectedDiagnostics: [],
  },
  {
    name: "shadowed-effect-binding",
    code: `import { useState, useRef } from "react";
const useEffect = (callback, dependencies) => {};
export const Example = () => {
  const [value, setValue] = useState(null);
  const valueRef = useRef<unknown>(null);
  useEffect(() => {
    (() => { fetch("/value").then((response) => response.json()).then(setValue); })();
  }, []);
  return null;
};
`,
    expectedDiagnostics: [],
  },
  {
    name: "nonrejecting-promise-root",
    code: `import { useEffect, useLayoutEffect, useState, useRef } from "react";
export const Example = () => {
  const [value, setValue] = useState(null);
  const valueRef = useRef<unknown>(null);
  useEffect(() => {
    (() => { Promise.resolve(1).then(setValue); })();
  }, []);
  return null;
};
`,
    expectedDiagnostics: [],
  },
  {
    name: "fake-setter-name",
    code: `import { useEffect, useLayoutEffect, useState, useRef } from "react";
export const Example = () => {
  const valueRef = useRef<unknown>(null);
  const setValue = (value) => {};
  useEffect(() => {
    (() => { fetch("/value").then((response) => response.json()).then(setValue); })();
  }, []);
  return null;
};
`,
    expectedDiagnostics: [],
  },
  {
    name: "dead-iife-invocation",
    code: `import { useEffect, useLayoutEffect, useState, useRef } from "react";
export const Example = () => {
  const [value, setValue] = useState(null);
  const valueRef = useRef<unknown>(null);
  useEffect(() => {
    if (false) { (() => { fetch("/value").then((response) => response.json()).then(setValue); })(); }
  }, []);
  return null;
};
`,
    expectedDiagnostics: [],
  },
  {
    name: "chain-after-return",
    code: `import { useEffect, useLayoutEffect, useState, useRef } from "react";
export const Example = () => {
  const [value, setValue] = useState(null);
  const valueRef = useRef<unknown>(null);
  useEffect(() => {
    (() => { return; fetch("/value").then((response) => response.json()).then(setValue); })();
  }, []);
  return null;
};
`,
    expectedDiagnostics: [],
  },
  {
    name: "chain-after-throw",
    code: `import { useEffect, useLayoutEffect, useState, useRef } from "react";
export const Example = () => {
  const [value, setValue] = useState(null);
  const valueRef = useRef<unknown>(null);
  useEffect(() => {
    (() => { throw new Error("stop"); fetch("/value").then((response) => response.json()).then(setValue); })();
  }, []);
  return null;
};
`,
    expectedDiagnostics: [],
  },
  {
    name: "own-await-after-floating-chain",
    code: `import { useEffect, useLayoutEffect, useState, useRef } from "react";
export const Example = () => {
  const [value, setValue] = useState(null);
  const valueRef = useRef<unknown>(null);
  useEffect(() => {
    (async () => { fetch("/value").then((response) => response.json()).then(setValue); await Promise.resolve(); })();
  }, []);
  return null;
};
`,
    expectedDiagnostics: [],
  },
  {
    name: "named-value-effect-import-alias",
    code: `import { useEffect as runEffect, useState, useRef } from "react";
export const Example = () => {
  const [value, setValue] = useState(null);
  const valueRef = useRef<unknown>(null);
  runEffect(() => {
    (() => { fetch("/value").then((response) => response.json()).then(setValue); })();
  }, []);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 13,
        line: 6,
        message: IMMEDIATE_IIFE_MESSAGE,
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "finally-is-not-catch",
    code: `import { useEffect, useLayoutEffect, useState, useRef } from "react";
export const Example = () => {
  const [value, setValue] = useState(null);
  const valueRef = useRef<unknown>(null);
  useEffect(() => {
    (() => { fetch("/value").then((response) => response.json()).then(setValue).finally(() => {}); })();
  }, []);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 13,
        line: 6,
        message: IMMEDIATE_IIFE_MESSAGE,
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "dead-chain-branch",
    code: `import { useEffect, useLayoutEffect, useState, useRef } from "react";
export const Example = () => {
  const [value, setValue] = useState(null);
  const valueRef = useRef<unknown>(null);
  useEffect(() => {
    (() => { if (false) { fetch("/value").then((response) => response.json()).then(setValue); } })();
  }, []);
  return null;
};
`,
    expectedDiagnostics: [],
  },
  {
    name: "class-static-initializer-iife",
    code: `import { useEffect, useLayoutEffect, useState, useRef } from "react";
export const Example = () => {
  const [value, setValue] = useState(null);
  const valueRef = useRef<unknown>(null);
  useEffect(() => {
    class DeferredOwner { static run = (() => { fetch("/value").then((response) => response.json()).then(setValue); })(); }
  }, []);
  return null;
};
`,
    expectedDiagnostics: [],
  },
  {
    name: "deferred-event-inside-iife",
    code: `import { useEffect, useLayoutEffect, useState, useRef } from "react";
export const Example = () => {
  const [value, setValue] = useState(null);
  const valueRef = useRef<unknown>(null);
  useEffect(() => {
    (() => { document.addEventListener("click", () => { fetch("/value").then((response) => response.json()).then(setValue); }); })();
  }, []);
  return null;
};
`,
    expectedDiagnostics: [],
  },
  {
    name: "then-setter-after-return",
    code: `import { useEffect, useLayoutEffect, useState, useRef } from "react";
export const Example = () => {
  const [value, setValue] = useState(null);
  const valueRef = useRef<unknown>(null);
  useEffect(() => {
    (async () => {
      fetch("/value").then((response) => { return; setValue(null); });
    })();
  }, []);
  return null;
};
`,
    expectedDiagnostics: [],
  },
  {
    name: "then-setter-in-false-branch",
    code: `import { useEffect, useLayoutEffect, useState, useRef } from "react";
export const Example = () => {
  const [value, setValue] = useState(null);
  const valueRef = useRef<unknown>(null);
  useEffect(() => {
    (async () => {
      fetch("/value").then((response) => { if (false) { setValue(null); } });
    })();
  }, []);
  return null;
};
`,
    expectedDiagnostics: [],
  },
  {
    name: "then-ref-write-after-return",
    code: `import { useEffect, useLayoutEffect, useState, useRef } from "react";
export const Example = () => {
  const [value, setValue] = useState(null);
  const valueRef = useRef<unknown>(null);
  useEffect(() => {
    (async () => {
      fetch("/value").then((response) => { return; valueRef.current = response; });
    })();
  }, []);
  return null;
};
`,
    expectedDiagnostics: [],
  },
  {
    name: "then-ref-write-in-false-branch",
    code: `import { useEffect, useLayoutEffect, useState, useRef } from "react";
export const Example = () => {
  const [value, setValue] = useState(null);
  const valueRef = useRef<unknown>(null);
  useEffect(() => {
    (async () => {
      fetch("/value").then((response) => { if (false) { valueRef.current = response; } });
    })();
  }, []);
  return null;
};
`,
    expectedDiagnostics: [],
  },
  {
    name: "then-callback-unconstructed-class-instance-field-setter",
    code: `import { useEffect, useLayoutEffect, useState, useRef } from "react";
export const Example = () => {
  const [value, setValue] = useState(null);
  const valueRef = useRef<unknown>(null);
  useEffect(() => {
    (async () => {
      fetch("/value").then(() => { class Deferred { field = setValue(null); } });
    })();
  }, []);
  return null;
};
`,
    expectedDiagnostics: [],
  },
  {
    name: "nested-static-field-write-is-conservative-unsupported-boundary",
    code: `import { useEffect, useLayoutEffect, useState, useRef } from "react";
export const Example = () => {
  const [value, setValue] = useState(null);
  const valueRef = useRef<unknown>(null);
  useEffect(() => {
    (async () => {
      fetch("/value").then(() => { class Deferred { static field = setValue(null); } });
    })();
  }, []);
  return null;
};
`,
    expectedDiagnostics: [],
  },
  {
    name: "mutable-state-dispatcher-replaced-before-effect",
    code: `import { useEffect, useLayoutEffect, useState, useRef } from "react";
export const Example = () => {
  let [value, setValue] = useState(null);
  setValue = () => {};
  const valueRef = useRef<unknown>(null);
  useEffect(() => {
    (async () => {
      fetch("/value").then((response) => response.json()).then(setValue);
    })();
  }, []);
  return null;
};
`,
    expectedDiagnostics: [],
  },
  {
    name: "mutable-ref-binding-replaced-before-effect",
    code: `import { useEffect, useLayoutEffect, useState, useRef } from "react";
export const Example = () => {
  const [value, setValue] = useState(null);
  let valueRef = useRef<unknown>(null);
  valueRef = { current: null };
  useEffect(() => {
    (async () => {
      fetch("/value").then((response) => { valueRef.current = response; });
    })();
  }, []);
  return null;
};
`,
    expectedDiagnostics: [],
  },
  {
    name: "const-state-alias-of-reassigned-mutable-hook-result",
    code: `import { useEffect, useLayoutEffect, useState, useRef } from "react";
export const Example = () => {
  let [value, setValue] = useState(null);
  setValue = () => {};
  const dispatchAlias = setValue;
  const valueRef = useRef<unknown>(null);
  useEffect(() => {
    (async () => {
      fetch("/value").then((response) => response.json()).then(dispatchAlias);
    })();
  }, []);
  return null;
};
`,
    expectedDiagnostics: [],
  },
  {
    name: "const-ref-alias-of-reassigned-mutable-hook-result",
    code: `import { useEffect, useLayoutEffect, useState, useRef } from "react";
export const Example = () => {
  const [value, setValue] = useState(null);
  let valueRef = useRef<unknown>(null);
  valueRef = { current: null };
  const refAlias = valueRef;
  useEffect(() => {
    (async () => {
      fetch("/value").then((response) => { refAlias.current = response; });
    })();
  }, []);
  return null;
};
`,
    expectedDiagnostics: [],
  },
  {
    name: "direct-const-state-result-from-renamed-value-import",
    code: `import { useEffect, useLayoutEffect, useState as createState, useRef } from "react";
export const Example = () => {
  const [value, setValue] = createState(null);
  const valueRef = useRef<unknown>(null);
  useEffect(() => {
    (async () => {
      fetch("/value").then((response) => response.json()).then(setValue);
    })();
  }, []);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 6,
        line: 7,
        message: IMMEDIATE_IIFE_MESSAGE,
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "direct-const-use-reducer-dispatcher",
    code: `import { useEffect, useLayoutEffect, useReducer, useRef } from "react";
export const Example = () => {
  const [value, setValue] = useReducer((_state: number, nextValue: number) => nextValue, 0);
  const valueRef = useRef<unknown>(null);
  useEffect(() => {
    (async () => {
      fetch("/value").then((response) => response.json()).then(setValue);
    })();
  }, []);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 6,
        line: 7,
        message: IMMEDIATE_IIFE_MESSAGE,
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "synchronous-local-throw-is-caught-before-any-promise-chain",
    code: `import { useEffect, useLayoutEffect, useState, useRef } from "react";
export const Example = () => {
  const [value, setValue] = useState(null);
  const valueRef = useRef<unknown>(null);
  const read: () => Promise<null> = () => { throw new Error("stop"); };
  useEffect(() => {
    try { (() => {
      read().then(setValue);
    })(); } catch {}
  }, []);
  return null;
};
`,
    expectedDiagnostics: [],
  },
  {
    name: "local-function-returning-native-fetch-is-unsupported",
    code: `import { useEffect, useLayoutEffect, useState, useRef } from "react";
export const Example = () => {
  const [value, setValue] = useState(null);
  const valueRef = useRef<unknown>(null);
  const read = () => fetch("/value");
  useEffect(() => {
    (async () => {
      read().then((response) => response.json()).then(setValue);
    })();
  }, []);
  return null;
};
`,
    expectedDiagnostics: [],
  },
  {
    name: "throwing-fetch-argument-is-caught-before-fetch-invocation",
    code: `import { useEffect, useLayoutEffect, useState, useRef } from "react";
export const Example = () => {
  const [value, setValue] = useState(null);
  const valueRef = useRef<unknown>(null);
  useEffect(() => {
    try { (() => {
      fetch((() => { throw new Error("stop"); })()).then(setValue);
    })(); } catch {}
  }, []);
  return null;
};
`,
    expectedDiagnostics: [],
  },
  {
    name: "external-resolved-handler-hides-reassigned-hook-result",
    code: `import { useEffect, useState } from "react";
export const Example = () => {
  let [value, setValue] = useState(null);
  setValue = () => {};
  const apply = () => { setValue(null); };
  useEffect(() => {
    (() => { fetch("/value").then(apply); })();
  }, []);
  return null;
};
`,
    expectedDiagnostics: [],
  },
  {
    name: "upstream-catch-recovery-is-conservative-unsupported",
    code: `import { useEffect, useLayoutEffect, useState, useRef } from "react";
export const Example = () => {
  const [value, setValue] = useState(null);
  const valueRef = useRef<unknown>(null);
  useEffect(() => {
    (async () => {
      fetch("/value").then((response) => response.json()).catch(() => null).then(setValue);
    })();
  }, []);
  return null;
};
`,
    expectedDiagnostics: [],
  },
  {
    name: "generator-then-handler-body-is-not-invoked-by-native-promise",
    code: `import { useEffect, useLayoutEffect, useState, useRef } from "react";
export const Example = () => {
  const [value, setValue] = useState(null);
  const valueRef = useRef<unknown>(null);
  useEffect(() => {
    (async () => {
      fetch("/value").then(function* () { setValue(null); });
    })();
  }, []);
  return null;
};
`,
    expectedDiagnostics: [],
  },
  {
    name: "default-second-handler-parameter-throws-before-state-write",
    code: `import { useEffect, useLayoutEffect, useState, useRef } from "react";
export const Example = () => {
  const [value, setValue] = useState(null);
  const valueRef = useRef<unknown>(null);
  const failBeforeWrite = (): never => { throw new Error("stop"); };
  useEffect(() => {
    (async () => {
      fetch("/value").then((response, unused = failBeforeWrite()) => { setValue(null); });
    })();
  }, []);
  return null;
};
`,
    expectedDiagnostics: [],
  },
  {
    name: "inline-nongenerator-function-json-callback-then-actual-setter",
    code: `import { useEffect, useLayoutEffect, useState, useRef } from "react";
export const Example = () => {
  const [value, setValue] = useState(null);
  const valueRef = useRef<unknown>(null);
  useEffect(() => {
    (async () => {
      fetch("/value").then(function (response) { return response.json(); }).then(setValue);
    })();
  }, []);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 6,
        line: 7,
        message: IMMEDIATE_IIFE_MESSAGE,
        nodeType: "CallExpression",
      },
    ],
  },
];

describe("no-promise-then-side-effect-in-effect-without-catch immediate IIFE", () => {
  it.each(CONTROLS)("$name", ({ code, expectedDiagnostics }) => {
    const result = runRule(noPromiseThenSideEffectInEffectWithoutCatch, code, RUN_RULE_OPTIONS);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual(expectedDiagnostics);
  });
});
