import { describe, expect, it } from "vite-plus/test";
import type { Rule } from "../../utils/rule.js";
import { runRule } from "../../../test-utils/run-rule.js";
import type { RunRuleOptions } from "../../../test-utils/run-rule.js";
import { noMatchMediaInStateInitializer } from "./no-match-media-in-state-initializer.js";

interface DiagnosticExpectationOptions extends RunRuleOptions {
  count?: number;
}

const expectDiagnostic = (
  rule: Rule,
  source: string,
  options: DiagnosticExpectationOptions = {},
): void => {
  const { count = 1, ...runRuleOptions } = options;
  const result = runRule(rule, source, runRuleOptions);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(count);
};

const expectNoDiagnostic = (rule: Rule, source: string, options: RunRuleOptions = {}): void => {
  const result = runRule(rule, source, options);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toEqual([]);
};

describe("no-match-media-in-state-initializer", () => {
  it("reports the issue #254 witness", async () => {
    const { diagnostics } = runRule(
      noMatchMediaInStateInitializer,
      `
      import { useState } from "react";
      const [isMobile] = useState(matchMedia("(max-width: 768px)").matches);
    `,
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain("SSR crash");
    expect(diagnostics[0]?.message).toContain("useSyncExternalStore");
  });

  it("reports eager and lazy direct calls", async () => {
    await expectDiagnostic(
      noMatchMediaInStateInitializer,
      `
        import { useState } from "react";
        const [isMobile] = useState(window.matchMedia("(max-width: 768px)").matches);
      `,
    );
    await expectDiagnostic(
      noMatchMediaInStateInitializer,
      `
        import { useState } from "react";
        const [isMobile] = useState(() => globalThis.matchMedia("(max-width: 768px)").matches);
      `,
    );
  });

  it("reports direct calls in lazy conditional and block bodies", async () => {
    await expectDiagnostic(
      noMatchMediaInStateInitializer,
      `
        import { useState } from "react";
        const [isMobile] = useState(() =>
          enabled ? matchMedia("(max-width: 768px)").matches : false
        );
      `,
    );
    await expectDiagnostic(
      noMatchMediaInStateInitializer,
      `
        import { useState } from "react";
        const [isMobile] = useState(function initialize() {
          if (!enabled) return false;
          return window.matchMedia("(max-width: 768px)").matches;
        });
      `,
    );
  });

  it("recognizes supported React import forms", async () => {
    await expectDiagnostic(
      noMatchMediaInStateInitializer,
      `
        import { useState as useReactState } from "react";
        const [isMobile] = useReactState(matchMedia("(max-width: 768px)").matches);
      `,
    );
    await expectDiagnostic(
      noMatchMediaInStateInitializer,
      `
        import React from "react";
        const [isMobile] = React.useState(matchMedia("(max-width: 768px)").matches);
      `,
    );
    await expectDiagnostic(
      noMatchMediaInStateInitializer,
      `
        import * as ReactNamespace from "react";
        const [isMobile] = ReactNamespace.useState(matchMedia("(max-width: 768px)").matches);
      `,
    );
    await expectDiagnostic(
      noMatchMediaInStateInitializer,
      `
        const [isMobile] = React.useState(matchMedia("(max-width: 768px)").matches);
      `,
    );
  });

  it("rejects unbound and shadowed useState references", async () => {
    await expectNoDiagnostic(
      noMatchMediaInStateInitializer,
      `
        const [isMobile] = useState(matchMedia("(max-width: 768px)").matches);
      `,
    );
    await expectNoDiagnostic(
      noMatchMediaInStateInitializer,
      `
        import { useState } from "react";
        const render = () => {
          const useState = initialize => [initialize];
          return useState(matchMedia("(max-width: 768px)").matches);
        };
      `,
    );
    await expectNoDiagnostic(
      noMatchMediaInStateInitializer,
      `
        import React from "react";
        const render = () => {
          const React = { useState: initialize => [initialize] };
          return React.useState(matchMedia("(max-width: 768px)").matches);
        };
      `,
    );
  });

  it("reports global bare, window, and globalThis matchMedia calls", async () => {
    await expectDiagnostic(
      noMatchMediaInStateInitializer,
      `
        import { useState } from "react";
        const [first] = useState(matchMedia("(max-width: 768px)").matches);
        const [second] = useState(window.matchMedia("(max-width: 768px)").matches);
        const [third] = useState(globalThis.matchMedia("(max-width: 768px)").matches);
      `,
      { count: 3 },
    );
  });

  it("rejects shadowed matchMedia receivers", async () => {
    await expectNoDiagnostic(
      noMatchMediaInStateInitializer,
      `
        import { useState } from "react";
        const matchMedia = query => ({ matches: query.length > 0 });
        const [isMobile] = useState(matchMedia("(max-width: 768px)").matches);
      `,
    );
    await expectNoDiagnostic(
      noMatchMediaInStateInitializer,
      `
        import { useState } from "react";
        const window = { matchMedia: query => ({ matches: query.length > 0 }) };
        const [isMobile] = useState(window.matchMedia("(max-width: 768px)").matches);
      `,
    );
    await expectNoDiagnostic(
      noMatchMediaInStateInitializer,
      `
        import { useState } from "react";
        const globalThis = { matchMedia: query => ({ matches: query.length > 0 }) };
        const [isMobile] = useState(globalThis.matchMedia("(max-width: 768px)").matches);
      `,
    );
  });

  it("ignores nested IIFEs in eager and lazy initializers", async () => {
    await expectNoDiagnostic(
      noMatchMediaInStateInitializer,
      `
        import { useState } from "react";
        const [isMobile] = useState(
          (() => matchMedia("(max-width: 768px)").matches)()
        );
      `,
    );
    await expectNoDiagnostic(
      noMatchMediaInStateInitializer,
      `
        import { useState } from "react";
        const [isMobile] = useState(() => {
          return (() => matchMedia("(max-width: 768px)").matches)();
        });
      `,
    );
  });

  it("ignores Promise executors", async () => {
    await expectNoDiagnostic(
      noMatchMediaInStateInitializer,
      `
        import { useState } from "react";
        const [state] = useState(new Promise(resolve => {
          resolve(matchMedia("(max-width: 768px)").matches);
        }));
      `,
    );
    await expectNoDiagnostic(
      noMatchMediaInStateInitializer,
      `
        import { useState } from "react";
        const [state] = useState(() => new Promise(resolve => {
          resolve(matchMedia("(max-width: 768px)").matches);
        }));
      `,
    );
  });

  it("ignores array iteration callbacks", async () => {
    await expectNoDiagnostic(
      noMatchMediaInStateInitializer,
      `
        import { useState } from "react";
        const [matches] = useState(
          ["(max-width: 768px)"].map(query => matchMedia(query).matches)
        );
      `,
    );
    await expectNoDiagnostic(
      noMatchMediaInStateInitializer,
      `
        import { useState } from "react";
        const [matches] = useState(() => {
          const results = [];
          ["(max-width: 768px)"].forEach(query => results.push(matchMedia(query).matches));
          return results;
        });
      `,
    );
  });

  it("ignores async lazy initializers and nested async functions", async () => {
    await expectNoDiagnostic(
      noMatchMediaInStateInitializer,
      `
        import { useState } from "react";
        const [isMobile] = useState(async () =>
          matchMedia("(max-width: 768px)").matches
        );
      `,
    );
    await expectNoDiagnostic(
      noMatchMediaInStateInitializer,
      `
        import { useState } from "react";
        const [isMobile] = useState(() => {
          const readMatch = async () => matchMedia("(max-width: 768px)").matches;
          return readMatch();
        });
      `,
    );
  });

  it("ignores generator lazy initializers and nested generators", async () => {
    await expectNoDiagnostic(
      noMatchMediaInStateInitializer,
      `
        import { useState } from "react";
        const [isMobile] = useState(function* initialize() {
          return matchMedia("(max-width: 768px)").matches;
        });
      `,
    );
    await expectNoDiagnostic(
      noMatchMediaInStateInitializer,
      `
        import { useState } from "react";
        const [isMobile] = useState(() => {
          function* readMatch() {
            return matchMedia("(max-width: 768px)").matches;
          }
          return readMatch();
        });
      `,
    );
  });

  it("ignores deferred and returned nested functions", async () => {
    await expectNoDiagnostic(
      noMatchMediaInStateInitializer,
      `
        import { useState } from "react";
        const [state] = useState(() => {
          setTimeout(() => matchMedia("(max-width: 768px)").matches, 0);
          return false;
        });
      `,
    );
    await expectNoDiagnostic(
      noMatchMediaInStateInitializer,
      `
        import { useState } from "react";
        const [readMatch] = useState(() =>
          () => matchMedia("(max-width: 768px)").matches
        );
      `,
    );
  });

  it("ignores test and React Native files", async () => {
    const source = `
      import { useState } from "react";
      const [isMobile] = useState(matchMedia("(max-width: 768px)").matches);
    `;
    await expectNoDiagnostic(noMatchMediaInStateInitializer, source, {
      filename: "component.test.tsx",
    });
    await expectNoDiagnostic(noMatchMediaInStateInitializer, source, {
      filename: "component.native.tsx",
    });
    await expectNoDiagnostic(noMatchMediaInStateInitializer, source, {
      filename: "app.tsx",
      settings: { "react-doctor": { framework: "react-native" } },
    });
  });

  it("keeps the SSR gate and warning severity", async () => {
    expect(noMatchMediaInStateInitializer.requires).toEqual(["ssr"]);
    expect(noMatchMediaInStateInitializer.severity).toBe("warn");
    await expectDiagnostic(
      noMatchMediaInStateInitializer,
      `
        import { useState } from "react";
        const [isMobile] = useState(matchMedia("(max-width: 768px)").matches);
      `,
      { settings: { "react-doctor": { framework: "unknown" } } },
    );
  });

  it("keeps eager overlap with rerender-lazy-state-init", async () => {
    const source = `
      import { useState } from "react";
      const [isMobile] = useState(matchMedia("(max-width: 768px)").matches);
    `;
    await expectDiagnostic(noMatchMediaInStateInitializer, source);

    const { rerenderLazyStateInit } =
      await import("../state-and-effects/rerender-lazy-state-init.js");
    await expectDiagnostic(rerenderLazyStateInit, source);
  });
});
