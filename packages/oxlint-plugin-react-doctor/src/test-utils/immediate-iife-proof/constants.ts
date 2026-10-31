import type { RuleDiagnostic } from "../run-rule.js";

interface ImmediateIifeBindingControl {
  name: string;
  code: string;
  expectedDiagnostics: RuleDiagnostic[];
}

export const IMMEDIATE_IIFE_BINDING_CONTROLS: ImmediateIifeBindingControl[] = [
  {
    name: "nominal-native-fetch",
    code: `import { useEffect, useState, useRef } from "react";
export const Example = () => {
  const [value, setValue] = useState<unknown>(null);
  useEffect(() => {
    (async () => {
      fetch("/value").then(setValue);
    })();
  }, []);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 6,
        line: 6,
        message:
          "This promise chain runs inside an immediately invoked function in an effect and sets state or mutates a ref without handling rejection. Add a rejection handler to this chain; an outer try/catch or promise catch does not handle a discarded inner chain.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "erased-use-effect",
    code: `import { useEffect, useState, useRef } from "react";
interface useEffect {}
export const Example = () => {
  const [value, setValue] = useState<unknown>(null);
  useEffect(() => {
    (async () => {
      fetch("/value").then(setValue);
    })();
  }, []);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 6,
        line: 7,
        message:
          "This promise chain runs inside an immediately invoked function in an effect and sets state or mutates a ref without handling rejection. Add a rejection handler to this chain; an outer try/catch or promise catch does not handle a discarded inner chain.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "erased-use-state",
    code: `import { useEffect, useState, useRef } from "react";
interface useState {}
export const Example = () => {
  const [value, setValue] = useState<unknown>(null);
  useEffect(() => {
    (async () => {
      fetch("/value").then(setValue);
    })();
  }, []);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 6,
        line: 7,
        message:
          "This promise chain runs inside an immediately invoked function in an effect and sets state or mutates a ref without handling rejection. Add a rejection handler to this chain; an outer try/catch or promise catch does not handle a discarded inner chain.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "erased-fetch-interface",
    code: `import { useEffect, useState, useRef } from "react";
interface fetch {}
export const Example = () => {
  const [value, setValue] = useState<unknown>(null);
  useEffect(() => {
    (async () => {
      fetch("/value").then(setValue);
    })();
  }, []);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 6,
        line: 7,
        message:
          "This promise chain runs inside an immediately invoked function in an effect and sets state or mutates a ref without handling rejection. Add a rejection handler to this chain; an outer try/catch or promise catch does not handle a discarded inner chain.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "erased-fetch-type-alias",
    code: `import { useEffect, useState, useRef } from "react";
type fetch = { label: string };
export const Example = () => {
  const [value, setValue] = useState<unknown>(null);
  useEffect(() => {
    (async () => {
      fetch("/value").then(setValue);
    })();
  }, []);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 6,
        line: 7,
        message:
          "This promise chain runs inside an immediately invoked function in an effect and sets state or mutates a ref without handling rejection. Add a rejection handler to this chain; an outer try/catch or promise catch does not handle a discarded inner chain.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "erased-state-setter",
    code: `import { useEffect, useState, useRef } from "react";
export const Example = () => {
  const [value, setValue] = useState<unknown>(null);
  interface setValue {}
  useEffect(() => {
    (async () => {
      fetch("/value").then(setValue);
    })();
  }, []);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 6,
        line: 7,
        message:
          "This promise chain runs inside an immediately invoked function in an effect and sets state or mutates a ref without handling rejection. Add a rejection handler to this chain; an outer try/catch or promise catch does not handle a discarded inner chain.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "runtime-fetch-shadow",
    code: `import { useEffect, useState, useRef } from "react";
export const Example = () => {
  const [value, setValue] = useState<unknown>(null);
  const fetch = () => Promise.resolve(null);
  useEffect(() => {
    (async () => {
      fetch("/value").then(setValue);
    })();
  }, []);
  return null;
};
`,
    expectedDiagnostics: [],
  },
  {
    name: "global-fetch-replaced-with-fulfilled-promise",
    code: `import { useEffect, useState, useRef } from "react";
globalThis.fetch = async () => new Response("{}");
export const Example = () => {
  const [value, setValue] = useState<unknown>(null);
  useEffect(() => {
    (async () => {
      fetch("/value").then(setValue);
    })();
  }, []);
  return null;
};
`,
    expectedDiagnostics: [],
  },
  {
    name: "inner-terminal-catch",
    code: `import { useEffect, useState, useRef } from "react";
export const Example = () => {
  const [value, setValue] = useState<unknown>(null);
  useEffect(() => {
    (async () => {
      fetch("/value").then(setValue).catch(() => {});
    })();
  }, []);
  return null;
};
`,
    expectedDiagnostics: [],
  },
  {
    name: "erased-ref-binding",
    code: `import { useEffect, useState, useRef } from "react";
export const Example = () => {
  const valueRef = useRef<unknown>(null);
  interface valueRef {}
  useEffect(() => {
    (async () => {
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
        message:
          "This promise chain runs inside an immediately invoked function in an effect and sets state or mutates a ref without handling rejection. Add a rejection handler to this chain; an outer try/catch or promise catch does not handle a discarded inner chain.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "bare-fetch-replacement",
    code: `import { useEffect, useState, useRef } from "react";
fetch = async () => new Response("{}");
export const Example = () => {
  const [value, setValue] = useState<unknown>(null);
  useEffect(() => {
    (async () => {
      fetch("/value").then(setValue);
    })();
  }, []);
  return null;
};
`,
    expectedDiagnostics: [],
  },
  {
    name: "native-promise-then-replacement",
    code: `import { useEffect, useState, useRef } from "react";
Promise.prototype.then = () => Promise.resolve(null);
export const Example = () => {
  const [value, setValue] = useState<unknown>(null);
  useEffect(() => {
    (async () => {
      fetch("/value").then(setValue);
    })();
  }, []);
  return null;
};
`,
    expectedDiagnostics: [],
  },
  {
    name: "unrelated-fetch-property",
    code: `import { useEffect, useState, useRef } from "react";
const client = {fetch: () => null}; client.fetch = () => null;
export const Example = () => {
  const [value, setValue] = useState<unknown>(null);
  useEffect(() => {
    (async () => {
      fetch("/value").then(setValue);
    })();
  }, []);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 6,
        line: 7,
        message:
          "This promise chain runs inside an immediately invoked function in an effect and sets state or mutates a ref without handling rejection. Add a rejection handler to this chain; an outer try/catch or promise catch does not handle a discarded inner chain.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "local-promise-prototype",
    code: `import { useEffect, useState, useRef } from "react";
const Promise = {prototype:{then: () => null}}; Promise.prototype.then = () => null;
export const Example = () => {
  const [value, setValue] = useState<unknown>(null);
  useEffect(() => {
    (async () => {
      fetch("/value").then(setValue);
    })();
  }, []);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 6,
        line: 7,
        message:
          "This promise chain runs inside an immediately invoked function in an effect and sets state or mutates a ref without handling rejection. Add a rejection handler to this chain; an outer try/catch or promise catch does not handle a discarded inner chain.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "direct-legacy-fetch-replacement",
    code: `import { useEffect, useState, useRef } from "react";
globalThis.fetch = async () => new Response("{}");
export const Example = () => {
  const [value, setValue] = useState<unknown>(null);
  useEffect(() => {
    fetch("/value").then(setValue);
  }, []);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 4,
        line: 6,
        message:
          "This promise chain runs in an effect, ends in a `.then` that sets state or mutates a ref, and has no `.catch` or enclosing try/catch, so a rejection leaves the state unset and surfaces as an unhandled rejection. Add a `.catch` handler on the chain (`.finally` does not count).",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "erased-global-object",
    code: `import { useEffect, useState, useRef } from "react";
interface globalThis {}
globalThis.fetch = async () => new Response("{}");
export const Example = () => {
  const [value, setValue] = useState<unknown>(null);
  useEffect(() => {
    (async () => {
      fetch("/value").then(setValue);
    })();
  }, []);
  return null;
};
`,
    expectedDiagnostics: [],
  },
  {
    name: "erased-global-object-alias",
    code: `import { useEffect, useState, useRef } from "react";
interface globalThis {}
const nativeGlobal = globalThis;
nativeGlobal.fetch = async () => new Response("{}");
export const Example = () => {
  const [value, setValue] = useState<unknown>(null);
  useEffect(() => {
    (async () => {
      fetch("/value").then(setValue);
    })();
  }, []);
  return null;
};
`,
    expectedDiagnostics: [],
  },
  {
    name: "erased-promise-alias",
    code: `import { useEffect, useState, useRef } from "react";
interface Promise {}
const NativePromise = Promise;
NativePromise.prototype.then = () => null;
export const Example = () => {
  const [value, setValue] = useState<unknown>(null);
  useEffect(() => {
    (async () => {
      fetch("/value").then(setValue);
    })();
  }, []);
  return null;
};
`,
    expectedDiagnostics: [],
  },
  {
    name: "runtime-global-object-companion",
    code: `import { useEffect, useState, useRef } from "react";
interface globalThis {}
const globalThis = {fetch: () => null};
globalThis.fetch = () => null;
export const Example = () => {
  const [value, setValue] = useState<unknown>(null);
  useEffect(() => {
    (async () => {
      fetch("/value").then(setValue);
    })();
  }, []);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 6,
        line: 9,
        message:
          "This promise chain runs inside an immediately invoked function in an effect and sets state or mutates a ref without handling rejection. Add a rejection handler to this chain; an outer try/catch or promise catch does not handle a discarded inner chain.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "runtime-promise-companion",
    code: `import { useEffect, useState, useRef } from "react";
interface Promise {}
const Promise = {prototype:{then: () => null}};
const NativePromise = Promise;
NativePromise.prototype.then = () => null;
export const Example = () => {
  const [value, setValue] = useState<unknown>(null);
  useEffect(() => {
    (async () => {
      fetch("/value").then(setValue);
    })();
  }, []);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 6,
        line: 10,
        message:
          "This promise chain runs inside an immediately invoked function in an effect and sets state or mutates a ref without handling rejection. Add a rejection handler to this chain; an outer try/catch or promise catch does not handle a discarded inner chain.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "const-fetch-key",
    code: `import { useEffect, useState, useRef } from "react";
const fetchKey = "fetch"; globalThis[fetchKey] = async () => new Response("{}");
export const Example = () => {
  const [value, setValue] = useState<unknown>(null);
  useEffect(() => {
    (async () => {
      fetch("/value").then(setValue);
    })();
  }, []);
  return null;
};
`,
    expectedDiagnostics: [],
  },
  {
    name: "const-prototype-key",
    code: `import { useEffect, useState, useRef } from "react";
const prototypeKey = "prototype"; Promise[prototypeKey].then = () => null;
export const Example = () => {
  const [value, setValue] = useState<unknown>(null);
  useEffect(() => {
    (async () => {
      fetch("/value").then(setValue);
    })();
  }, []);
  return null;
};
`,
    expectedDiagnostics: [],
  },
  {
    name: "global-provider-parameter-property",
    code: `import { useEffect, useState, useRef } from "react";
class Setup { constructor(public value = (globalThis.fetch = () => Promise.resolve("ok"))) {} }
new Setup();
export const Example = () => {
  const [value, setValue] = useState<unknown>(null);
  useEffect(() => {
    (async () => {
      fetch("/value").then(setValue);
    })();
  }, []);
  return null;
};
`,
    expectedDiagnostics: [],
  },
  {
    name: "local-object-parameter-property",
    code: `import { useEffect, useState, useRef } from "react";
const localProvider = { fetch: () => Promise.resolve("local") };
class Setup { constructor(public value = (localProvider.fetch = () => Promise.resolve("ok"))) {} }
new Setup();
export const Example = () => {
  const [value, setValue] = useState<unknown>(null);
  useEffect(() => {
    (async () => {
      fetch("/value").then(setValue);
    })();
  }, []);
  return null;
};
`,
    expectedDiagnostics: [],
  },
];
