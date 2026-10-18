import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import type { RuleDiagnostic, RunRuleOptions } from "../../../test-utils/run-rule.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

interface LocalAllocatorCleanupCase {
  name: string;
  code: string;
  expectedDiagnostics: RuleDiagnostic[];
}

const localAllocatorOptions: RunRuleOptions = {
  filename: "synthetic-effect-local-disposer.tsx",
  includeLocations: true,
  settings: {
    "react-doctor": {
      portedRuleMode: "curated",
      capabilities: ["react"],
    },
  },
};

const unreleasedListenerDiagnostics: RuleDiagnostic[] = [
  {
    column: 2,
    line: 3,
    message:
      "`addEventListener` creates a subscription in useEffect without guaranteed cleanup. Return a cleanup function that owns every allocation so it does not leak after unmount.",
    nodeType: "CallExpression",
  },
];

const localAllocatorCases: LocalAllocatorCleanupCase[] = [
  {
    name: "one-local-allocator-returned-disposer",
    code: `import { useEffect, useRef } from "react";
export const Example = () => {
  useEffect(() => {
    const handler = () => {};
    const allocate = () => {
      document.addEventListener("click", handler, false);
      return () => document.removeEventListener("click", handler, false);
    };
    return allocate();
  }, []);
  return null;
};
`,
    expectedDiagnostics: [],
  },
  {
    name: "two-helper-switch-modes",
    code: `import { useEffect, useRef } from "react";
export const Example = ({ mode }: { mode: string }) => {
  useEffect(() => {
    const handler = () => {};
    const scroll = () => { document.addEventListener("scroll", handler); return () => document.removeEventListener("scroll", handler); };
    const cursor = () => { document.addEventListener("mousemove", handler); document.addEventListener("mouseout", handler); return () => { document.removeEventListener("mousemove", handler); document.removeEventListener("mouseout", handler); }; };
    switch (mode) { case "scroll": return scroll(); case "cursor": return cursor(); }
  }, []);
  return null;
};
`,
    expectedDiagnostics: [],
  },
  {
    name: "captured-native-target-before-allocator",
    code: `import { useEffect, useRef } from "react";
export const Example = ({ targetRef }: { targetRef: { current: HTMLDivElement | null } }) => {
  useEffect(() => {
    const target = targetRef.current;
    if (!target) return;
    const handler = () => {};
    const allocate = () => {
      target.addEventListener("click", handler, false);
      return () => target.removeEventListener("click", handler, false);
    };
    return allocate();
  }, []);
  return null;
};
`,
    expectedDiagnostics: [],
  },
  {
    name: "no-allocation-early-guard",
    code: `import { useEffect, useRef } from "react";
export const Example = ({ enabled }: { enabled: boolean }) => {
  useEffect(() => {
    if (!enabled) return;
    const handler = () => {};
    const allocate = () => {
      document.addEventListener("click", handler, false);
      return () => document.removeEventListener("click", handler, false);
    };
    return allocate();
  }, []);
  return null;
};
`,
    expectedDiagnostics: [],
  },
  {
    name: "direct-returned-cleanup-old-control",
    code: `import { useEffect, useRef } from "react";
export const Example = () => {
  useEffect(() => {
    const handler = () => {};
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, []);
  return null;
};
`,
    expectedDiagnostics: [],
  },
  {
    name: "wrong-handler",
    code: `import { useEffect, useRef } from "react";
export const Example = () => {
  useEffect(() => {
    const handler = () => {};
    const allocate = () => {
      document.addEventListener("click", handler, false);
      return () => document.removeEventListener("click", () => {}, false);
    };
    return allocate();
  }, []);
  return null;
};
`,
    expectedDiagnostics: unreleasedListenerDiagnostics,
  },
  {
    name: "wrong-event",
    code: `import { useEffect, useRef } from "react";
export const Example = () => {
  useEffect(() => {
    const handler = () => {};
    const allocate = () => {
      document.addEventListener("click", handler, false);
      return () => document.removeEventListener("keydown", handler, false);
    };
    return allocate();
  }, []);
  return null;
};
`,
    expectedDiagnostics: unreleasedListenerDiagnostics,
  },
  {
    name: "wrong-capture",
    code: `import { useEffect, useRef } from "react";
export const Example = () => {
  useEffect(() => {
    const handler = () => {};
    const allocate = () => {
      document.addEventListener("click", handler, false);
      return () => document.removeEventListener("click", handler, true);
    };
    return allocate();
  }, []);
  return null;
};
`,
    expectedDiagnostics: unreleasedListenerDiagnostics,
  },
  {
    name: "wrong-receiver",
    code: `import { useEffect, useRef } from "react";
export const Example = () => {
  useEffect(() => {
    const handler = () => {};
    const allocate = () => {
      document.addEventListener("click", handler, false);
      return () => window.removeEventListener("click", handler, false);
    };
    return allocate();
  }, []);
  return null;
};
`,
    expectedDiagnostics: unreleasedListenerDiagnostics,
  },
  {
    name: "only-one-of-two-released",
    code: `import { useEffect, useRef } from "react";
export const Example = () => {
  useEffect(() => {
    const handler = () => {};
    const allocate = () => {
      document.addEventListener("click", handler, false);
      document.addEventListener("keydown", handler, false);
      return () => document.removeEventListener("click", handler, false);
    };
    return allocate();
  }, []);
  return null;
};
`,
    expectedDiagnostics: unreleasedListenerDiagnostics,
  },
  {
    name: "helper-called-result-ignored",
    code: `import { useEffect, useRef } from "react";
export const Example = () => {
  useEffect(() => {
    const handler = () => {};
    const allocate = () => {
      document.addEventListener("click", handler, false);
      return () => document.removeEventListener("click", handler, false);
    };
    allocate();
  }, []);
  return null;
};
`,
    expectedDiagnostics: unreleasedListenerDiagnostics,
  },
  {
    name: "return-allocator-without-invocation",
    code: `import { useEffect, useRef } from "react";
export const Example = () => {
  useEffect(() => {
    const handler = () => {};
    const allocate = () => {
      document.addEventListener("click", handler, false);
      return () => document.removeEventListener("click", handler, false);
    };
    return allocate;
  }, []);
  return null;
};
`,
    expectedDiagnostics: [],
  },
  {
    name: "discard-first-return-second",
    code: `import { useEffect, useRef } from "react";
export const Example = () => {
  useEffect(() => {
    const allocate = () => {
      const handler = () => {};
      document.addEventListener("click", handler, false);
      return () => document.removeEventListener("click", handler, false);
    };
    allocate();
    return allocate();
  }, []);
  return null;
};
`,
    expectedDiagnostics: unreleasedListenerDiagnostics,
  },
  {
    name: "post-allocation-bare-return",
    code: `import { useEffect, useRef } from "react";
export const Example = ({ enabled }: { enabled: boolean }) => {
  useEffect(() => {
    const handler = () => {};
    const allocate = () => {
      document.addEventListener("click", handler, false);
      if (enabled) return;
      return () => document.removeEventListener("click", handler, false);
    };
    return allocate();
  }, []);
  return null;
};
`,
    expectedDiagnostics: unreleasedListenerDiagnostics,
  },
  {
    name: "post-allocation-unknown-call",
    code: `import { useEffect, useRef } from "react";
export const Example = ({ uncertain }: { uncertain: () => void }) => {
  useEffect(() => {
    const handler = () => {};
    const allocate = () => {
      document.addEventListener("click", handler, false);
      uncertain();
      return () => document.removeEventListener("click", handler, false);
    };
    return allocate();
  }, []);
  return null;
};
`,
    expectedDiagnostics: unreleasedListenerDiagnostics,
  },
  {
    name: "async-allocator",
    code: `import { useEffect, useRef } from "react";
export const Example = () => {
  useEffect(() => {
    const handler = () => {};
    const allocate = async () => {
      document.addEventListener("click", handler, false);
      return () => document.removeEventListener("click", handler, false);
    };
    return allocate();
  }, []);
  return null;
};
`,
    expectedDiagnostics: unreleasedListenerDiagnostics,
  },
  {
    name: "generator-allocator",
    code: `import { useEffect, useRef } from "react";
export const Example = () => {
  useEffect(() => {
    const handler = () => {};
    const allocate = function* () {
      document.addEventListener("click", handler, false);
      return () => document.removeEventListener("click", handler, false);
    };
    return allocate();
  }, []);
  return null;
};
`,
    expectedDiagnostics: unreleasedListenerDiagnostics,
  },
  {
    name: "parameterized-allocator",
    code: `import { useEffect, useRef } from "react";
export const Example = () => {
  useEffect(() => {
    const handler = () => {};
    const allocate = (target: Document) => {
      document.addEventListener("click", handler, false);
      return () => document.removeEventListener("click", handler, false);
    };
    return allocate(document);
  }, []);
  return null;
};
`,
    expectedDiagnostics: unreleasedListenerDiagnostics,
  },
  {
    name: "reassigned-allocator",
    code: `import { useEffect, useRef } from "react";
export const Example = () => {
  useEffect(() => {
    const handler = () => {};
    let allocate = () => {
      document.addEventListener("click", handler, false);
      return () => document.removeEventListener("click", handler, false);
    };
    allocate = () => undefined;
    return allocate();
  }, []);
  return null;
};
`,
    expectedDiagnostics: [],
  },
  {
    name: "transport-allocator",
    code: `import { useEffect, useRef } from "react";
export const Example = ({ receive }: { receive: (value: unknown) => void }) => {
  useEffect(() => {
    const handler = () => {};
    const allocate = () => {
      document.addEventListener("click", handler, false);
      return () => document.removeEventListener("click", handler, false);
    };
    receive(allocate);
    return allocate();
  }, []);
  return null;
};
`,
    expectedDiagnostics: unreleasedListenerDiagnostics,
  },
  {
    name: "alias-allocator",
    code: `import { useEffect, useRef } from "react";
export const Example = () => {
  useEffect(() => {
    const handler = () => {};
    const allocate = () => {
      document.addEventListener("click", handler, false);
      return () => document.removeEventListener("click", handler, false);
    };
    const alias = allocate;
    return alias();
  }, []);
  return null;
};
`,
    expectedDiagnostics: [],
  },
  {
    name: "computed-member-allocator",
    code: `import { useEffect, useRef } from "react";
export const Example = () => {
  useEffect(() => {
    const handler = () => {};
    const allocate = () => {
      document.addEventListener("click", handler, false);
      return () => document.removeEventListener("click", handler, false);
    };
    const holder = { allocate };
    return holder["allocate"]();
  }, []);
  return null;
};
`,
    expectedDiagnostics: [],
  },
  {
    name: "promise-deferred-allocation",
    code: `import { useEffect, useRef } from "react";
export const Example = () => {
  useEffect(() => {
    const handler = () => {};
    const allocate = () => { Promise.resolve().then(() => document.addEventListener("click", handler)); return () => document.removeEventListener("click", handler); };
    return allocate();
  }, []);
  return null;
};
`,
    expectedDiagnostics: unreleasedListenerDiagnostics,
  },
  {
    name: "recursive-allocator",
    code: `import { useEffect, useRef } from "react";
export const Example = ({ enabled }: { enabled: boolean }) => {
  useEffect(() => {
    const handler = () => {};
    const allocate = () => {
      document.addEventListener("click", handler, false);
      if (enabled) allocate();
      return () => document.removeEventListener("click", handler, false);
    };
    return allocate();
  }, []);
  return null;
};
`,
    expectedDiagnostics: unreleasedListenerDiagnostics,
  },
  {
    name: "finally-discards-cleanup",
    code: `import { useEffect, useRef } from "react";
export const Example = () => {
  useEffect(() => {
    const handler = () => {};
    const allocate = () => { document.addEventListener("click", handler); try { return () => document.removeEventListener("click", handler); } finally { return; } };
    return allocate();
  }, []);
  return null;
};
`,
    expectedDiagnostics: unreleasedListenerDiagnostics,
  },
  {
    name: "mutable-ref-cleanup-target",
    code: `import { useEffect, useRef } from "react";
export const Example = ({ targetRef }: { targetRef: { current: HTMLDivElement | null } }) => {
  useEffect(() => {
    const target = targetRef.current;
    if (!target) return;
    const handler = () => {};
    const allocate = () => {
      target.addEventListener("click", handler, false);
      return () => targetRef.current?.removeEventListener("click", handler, false);
    };
    return allocate();
  }, []);
  return null;
};
`,
    expectedDiagnostics: unreleasedListenerDiagnostics,
  },
  {
    name: "direct-eval-replaces-helper",
    code: `import { useEffect, useRef } from "react";
export const Example = () => {
  useEffect(() => {
    const handler = () => {};
    const allocate = () => {
      document.addEventListener("click", handler, false);
      return () => document.removeEventListener("click", handler, false);
    };
    eval("allocate = () => undefined");
    return allocate();
  }, []);
  return null;
};
`,
    expectedDiagnostics: unreleasedListenerDiagnostics,
  },
  {
    name: "global-property-mutation-before-return",
    code: `import { useEffect, useRef } from "react";
export const Example = () => {
  useEffect(() => {
    const handler = () => {};
    const allocate = () => {
      document.addEventListener("click", handler, false);
      Object.defineProperty(document, "removeEventListener", { value: () => {} });
      return () => document.removeEventListener("click", handler, false);
    };
    return allocate();
  }, []);
  return null;
};
`,
    expectedDiagnostics: unreleasedListenerDiagnostics,
  },
  {
    name: "unknown-dynamic-provider-module",
    code: `import { useEffect, useRef } from "react";
export const Example = () => {
  useEffect(() => {
    void import("unknown-provider");
    const handler = () => {};
    const allocate = () => {
      document.addEventListener("click", handler, false);
      return () => document.removeEventListener("click", handler, false);
    };
    return allocate();
  }, []);
  return null;
};
`,
    expectedDiagnostics: unreleasedListenerDiagnostics,
  },
  {
    name: "erased-react-hook-import",
    code: `import type { useEffect, useRef } from "react";
export const Example = () => {
  useEffect(() => {
    const handler = () => {};
    const allocate = () => {
      document.addEventListener("click", handler, false);
      return () => document.removeEventListener("click", handler, false);
    };
    return allocate();
  }, []);
  return null;
};
`,
    expectedDiagnostics: unreleasedListenerDiagnostics,
  },
  {
    name: "two-cleanups-one-return-unrelated",
    code: `import { useEffect, useRef } from "react";
export const Example = () => {
  useEffect(() => {
    const handler = () => {};
    const allocate = () => { document.addEventListener("click", handler); const release = () => document.removeEventListener("click", handler); return () => {}; };
    return allocate();
  }, []);
  return null;
};
`,
    expectedDiagnostics: unreleasedListenerDiagnostics,
  },
  {
    name: "cleanup-removes-then-reallocates",
    code: `import { useEffect, useRef } from "react";
export const Example = () => {
  useEffect(() => {
    const handler = () => {};
    const allocate = () => {
      document.addEventListener("click", handler, false);
      return () => { document.removeEventListener("click", handler, false); document.addEventListener("click", handler, false); };
    };
    return allocate();
  }, []);
  return null;
};
`,
    expectedDiagnostics: unreleasedListenerDiagnostics,
  },
  {
    name: "generator-returned-disposer",
    code: `import { useEffect, useRef } from "react";
export const Example = () => {
  useEffect(() => {
    const handler = () => {};
    const allocate = () => {
      document.addEventListener("click", handler, false);
      return function* () { document.removeEventListener("click", handler, false); };
    };
    return allocate();
  }, []);
  return null;
};
`,
    expectedDiagnostics: unreleasedListenerDiagnostics,
  },
  {
    name: "async-returned-disposer-await-before-remove",
    code: `import { useEffect, useRef } from "react";
export const Example = () => {
  useEffect(() => {
    const handler = () => {};
    const allocate = () => {
      document.addEventListener("click", handler, false);
      return async () => { await Promise.resolve(); document.removeEventListener("click", handler, false); };
    };
    return allocate();
  }, []);
  return null;
};
`,
    expectedDiagnostics: unreleasedListenerDiagnostics,
  },
  {
    name: "opaque-cleanup-call-before-remove",
    code: `import { useEffect, useRef } from "react";
export const Example = ({ consume }) => {
  useEffect(() => {
    const handler = () => {};
    const allocate = () => {
      document.addEventListener("click", handler, false);
      return () => { consume(); document.removeEventListener("click", handler, false); };
    };
    return allocate();
  }, []);
  return null;
};
`,
    expectedDiagnostics: unreleasedListenerDiagnostics,
  },
  {
    name: "conditional-missing-cleanup-removal",
    code: `import { useEffect, useRef } from "react";
export const Example = ({ enabled }) => {
  useEffect(() => {
    const handler = () => {};
    const allocate = () => {
      document.addEventListener("click", handler, false);
      return () => { if (enabled) document.removeEventListener("click", handler, false); };
    };
    return allocate();
  }, []);
  return null;
};
`,
    expectedDiagnostics: unreleasedListenerDiagnostics,
  },
  {
    name: "property-getter-throws-before-returning-disposer",
    code: `import { useEffect } from "react";
export const Example = () => {
  const probe = {
    get value(): string {
      throw new Error("release probe failed");
    },
  };
  useEffect(() => {
    const handler = () => {};
    const allocate = () => {
      document.addEventListener("click", handler, false);
      probe.value;
      return () => {
        document.removeEventListener("click", handler, false);
      };
    };
    return allocate();
  }, []);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 2,
        line: 8,
        message:
          "`addEventListener` creates a subscription in useEffect without guaranteed cleanup. Return a cleanup function that owns every allocation so it does not leak after unmount.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "property-getter-throws-before-matching-removal",
    code: `import { useEffect } from "react";
export const Example = () => {
  const probe = {
    get value(): string {
      throw new Error("release probe failed");
    },
  };
  useEffect(() => {
    const handler = () => {};
    const allocate = () => {
      document.addEventListener("click", handler, false);
      return () => {
        probe.value;
        document.removeEventListener("click", handler, false);
      };
    };
    return allocate();
  }, []);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 2,
        line: 8,
        message:
          "`addEventListener` creates a subscription in useEffect without guaranteed cleanup. Return a cleanup function that owns every allocation so it does not leak after unmount.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "builtin-console-argument-getter-throws-before-removal",
    code: `import { useEffect } from "react";
export const Example = () => {
  const probe = {
    get value(): string {
      throw new Error("release probe failed");
    },
  };
  useEffect(() => {
    const handler = () => {};
    const allocate = () => {
      document.addEventListener("click", handler, false);
      return () => {
        console.log(probe.value);
        document.removeEventListener("click", handler, false);
      };
    };
    return allocate();
  }, []);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 2,
        line: 8,
        message:
          "`addEventListener` creates a subscription in useEffect without guaranteed cleanup. Return a cleanup function that owns every allocation so it does not leak after unmount.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "runtime-typescript-namespace-replaces-native-removal",
    code: `import { useEffect } from "react";
namespace NativeMutation {
  document.removeEventListener = () => {};
}
export const Example = () => {
  useEffect(() => {
    const handler = () => {};
    const allocate = () => {
      document.addEventListener("click", handler, false);
      return () => document.removeEventListener("click", handler, false);
    };
    return allocate();
  }, []);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 2,
        line: 6,
        message:
          "`addEventListener` creates a subscription in useEffect without guaranteed cleanup. Return a cleanup function that owns every allocation so it does not leak after unmount.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "bigint-division-zero-before-returning-disposer",
    code: `import { useEffect } from "react";
export const Example = () => {
  useEffect(() => {
    const handler = () => {};
    const allocate = () => {
      document.addEventListener("click", handler, false);
      const quotient = 1n / 0n;
      return () => document.removeEventListener("click", handler, false);
    };
    return allocate();
  }, []);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 2,
        line: 3,
        message:
          "`addEventListener` creates a subscription in useEffect without guaranteed cleanup. Return a cleanup function that owns every allocation so it does not leak after unmount.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "destructuring-getter-throws-before-returning-disposer",
    code: `import { useEffect } from "react";
export const Example = () => {
  const probe = {
    get value(): string {
      throw new Error("release probe failed");
    },
  };
  useEffect(() => {
    const handler = () => {};
    const allocate = () => {
      document.addEventListener("click", handler, false);
      const { value } = probe;
      return () => {
        document.removeEventListener("click", handler, false);
      };
    };
    return allocate();
  }, []);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 2,
        line: 8,
        message:
          "`addEventListener` creates a subscription in useEffect without guaranteed cleanup. Return a cleanup function that owns every allocation so it does not leak after unmount.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "second-handler-tdz-after-first-native-registration",
    code: `import { useEffect } from "react";
export const Example = () => {
  useEffect(() => {
    const firstHandler = () => {};
    const allocate = () => {
      document.addEventListener("click", firstHandler, false);
      document.addEventListener("keyup", laterHandler, false);
      const laterHandler = () => {};
      return () => {
        document.removeEventListener("click", firstHandler, false);
        document.removeEventListener("keyup", laterHandler, false);
      };
    };
    return allocate();
  }, []);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 2,
        line: 3,
        message:
          "`addEventListener` creates a subscription in useEffect without guaranteed cleanup. Return a cleanup function that owns every allocation so it does not leak after unmount.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "unguarded-nullable-captured-ref-after-native-registration",
    code: `import { useEffect } from "react";
interface TargetRef {
  current: HTMLDivElement | null;
}
interface ExampleProps {
  targetRef: TargetRef;
}
export const Example = ({ targetRef }: ExampleProps) => {
  useEffect(() => {
    const target = targetRef.current;
    const handler = () => {};
    const allocate = () => {
      document.addEventListener("click", handler, false);
      target.addEventListener("keyup", handler, false);
      return () => {
        document.removeEventListener("click", handler, false);
        target.removeEventListener("keyup", handler, false);
      };
    };
    return allocate();
  }, []);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 2,
        line: 9,
        message:
          "`addEventListener` creates a subscription in useEffect without guaranteed cleanup. Return a cleanup function that owns every allocation so it does not leak after unmount.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "cleanup-handler-tdz-before-removing-earlier-allocation",
    code: `import { useEffect } from "react";
export const Example = () => {
  useEffect(() => {
    const handler = () => {};
    const allocate = () => {
      document.addEventListener("click", handler, false);
      return () => {
        document.removeEventListener("keyup", laterHandler, false);
        document.removeEventListener("click", handler, false);
      };
      const laterHandler = () => {};
    };
    return allocate();
  }, []);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 2,
        line: 3,
        message:
          "`addEventListener` creates a subscription in useEffect without guaranteed cleanup. Return a cleanup function that owns every allocation so it does not leak after unmount.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "false-sentinel-guard-does-not-prove-captured-ref-presence",
    code: `import { useEffect } from "react";
interface TargetRef {
  current: HTMLDivElement | null;
}
interface ExampleProps {
  targetRef: TargetRef;
}
export const Example = ({ targetRef }: ExampleProps) => {
  useEffect(() => {
    const target = targetRef.current;
    if (target === -1) return;
    const handler = () => {};
    const allocate = () => {
      document.addEventListener("click", handler, false);
      target.addEventListener("keyup", handler, false);
      return () => {
        document.removeEventListener("click", handler, false);
        target.removeEventListener("keyup", handler, false);
      };
    };
    return allocate();
  }, []);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 2,
        line: 9,
        message:
          "`addEventListener` creates a subscription in useEffect without guaranteed cleanup. Return a cleanup function that owns every allocation so it does not leak after unmount.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "aliased-native-document-prototype-removal-override",
    code: `import { useEffect, useRef } from "react";
const nativeTarget = document;
nativeTarget.__proto__ = { __proto__: nativeTarget.__proto__, removeEventListener: () => {} };
export const Example = () => {
  useEffect(() => {
    const handler = () => {};
    const allocate = () => {
      document.addEventListener("click", handler, false);
      return () => document.removeEventListener("click", handler, false);
    };
    return allocate();
  }, []);
  return null;
};
`,
    expectedDiagnostics: [
      {
        column: 2,
        line: 5,
        message:
          "`addEventListener` creates a subscription in useEffect without guaranteed cleanup. Return a cleanup function that owns every allocation so it does not leak after unmount.",
        nodeType: "CallExpression",
      },
    ],
  },
];

describe("effect-needs-cleanup local allocator ownership", () => {
  it.each(localAllocatorCases)("$name", ({ code, expectedDiagnostics }) => {
    const result = runRule(effectNeedsCleanup, code, localAllocatorOptions);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual(expectedDiagnostics);
  });
});
