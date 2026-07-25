import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noPassDataToParent } from "./no-pass-data-to-parent.js";
import { noPassLiveStateToParent } from "./no-pass-live-state-to-parent.js";
import { noPropCallbackInEffect } from "./no-prop-callback-in-effect.js";

interface ParentSyncProvenanceCase {
  code: string;
  name: string;
}

const mustReportCases: ParentSyncProvenanceCase[] = [
  {
    name: "direct prop callbacks",
    code: `import { useEffect, useState } from "react";
      const Child = ({ onChange }) => {
        const [value] = useState(0);
        useEffect(() => onChange(buildPayload(value)), [onChange, value]);
        return null;
      };`,
  },
  {
    name: "direct React useEffectEvent wrappers",
    code: `import { useEffect, useEffectEvent, useState } from "react";
      const Child = ({ onChange }) => {
        const [value] = useState(0);
        const notify = useEffectEvent(onChange);
        useEffect(() => notify(buildPayload(value)), [value]);
        return null;
      };`,
  },
  {
    name: "namespace React useEffectEvent member wrappers",
    code: `import * as React from "react";
      const Child = (props) => {
        const [value] = React.useState(0);
        const notify = React.useEffectEvent(props.onChange);
        React.useEffect(() => notify(buildPayload(value)), [value]);
        return null;
      };`,
  },
  {
    name: "direct React useCallback wrappers",
    code: `import { useCallback, useEffect, useState } from "react";
      const Child = ({ onChange }) => {
        const [value] = useState(0);
        const notify = useCallback(onChange, [onChange]);
        useEffect(() => notify(buildPayload(value)), [notify, value]);
        return null;
      };`,
  },
  {
    name: "inline React useEffectEvent wrappers",
    code: `import { useEffect, useEffectEvent, useState } from "react";
      const Child = ({ onChange }) => {
        const [value] = useState(0);
        const notify = useEffectEvent((nextValue) => onChange(nextValue));
        useEffect(() => notify(buildPayload(value)), [value]);
        return null;
      };`,
  },
  {
    name: "immutable callback aliases",
    code: `import { useEffect, useState } from "react";
      const Child = ({ onChange }) => {
        const [value] = useState(0);
        const notify = onChange;
        useEffect(() => notify(buildPayload(value)), [notify, value]);
        return null;
      };`,
  },
  {
    name: "ref-held callbacks",
    code: `import { useEffect, useRef, useState } from "react";
      const Child = ({ onChange }) => {
        const [value] = useState(0);
        const notifyRef = useRef(onChange);
        useEffect(() => {
          notifyRef.current = onChange;
        }, [onChange]);
        useEffect(() => notifyRef.current(buildPayload(value)), [value]);
        return null;
      };`,
  },
  {
    name: "immutable ref aliases",
    code: `import { useEffect, useRef, useState } from "react";
      const Child = ({ onChange }) => {
        const [value] = useState(0);
        const callbackRef = useRef(onChange);
        const callbackRefAlias = callbackRef;
        useEffect(() => callbackRefAlias.current(buildPayload(value)), [value]);
        return null;
      };`,
  },
  {
    name: "ref-current callback aliases",
    code: `import { useEffect, useRef, useState } from "react";
      const Child = ({ onChange }) => {
        const [value] = useState(0);
        const callbackRef = useRef(onChange);
        const notify = callbackRef.current;
        useEffect(() => notify(buildPayload(value)), [value]);
        return null;
      };`,
  },
  {
    name: "ref-current callback snapshots before local overwrites",
    code: `import { useEffect, useRef, useState } from "react";
      const Child = ({ onChange }) => {
        const [value] = useState(0);
        const callbackRef = useRef(onChange);
        const notify = callbackRef.current;
        callbackRef.current = console.log;
        useEffect(() => notify(buildPayload(value)), [value]);
        return null;
      };`,
  },
  {
    name: "plain object current callback aliases",
    code: `import { useEffect, useState } from "react";
      const Child = ({ onChange }) => {
        const [value] = useState(0);
        const callbackBag = { current: onChange };
        useEffect(() => callbackBag.current(buildPayload(value)), [value]);
        return null;
      };`,
  },
  {
    name: "React callback refs listed in dependency arrays",
    code: `import { useEffect, useRef, useState } from "react";
      const Child = ({ onChange }) => {
        const [value] = useState(0);
        const callbackRef = useRef(onChange);
        useEffect(() => callbackRef.current(buildPayload(value)), [callbackRef, value]);
        return null;
      };`,
  },
  {
    name: "React callback refs listed in named hook alias dependency arrays",
    code: `import { useEffect, useMemo, useRef, useState } from "react";
      const useStableMemo = useMemo;
      const Child = ({ onChange }) => {
        const [value] = useState(0);
        const callbackRef = useRef(onChange);
        useStableMemo(() => callbackRef.current, [callbackRef]);
        useEffect(() => callbackRef.current(buildPayload(value)), [value]);
        return null;
      };`,
  },
  {
    name: "callback refs with uninvoked hoisted reset helpers",
    code: `import { useEffect, useRef, useState } from "react";
      const Child = ({ onChange }) => {
        const [value] = useState(0);
        const callbackRef = useRef(onChange);
        const notify = callbackRef.current;
        function reset() {
          callbackRef.current = console.log;
        }
        useEffect(() => notify(buildPayload(value)), [value]);
        return null;
      };`,
  },
  {
    name: "ref snapshots after object methods overwritten with local callbacks",
    code: `import { useEffect, useRef, useState } from "react";
      const Child = ({ onChange }) => {
        const [value] = useState(0);
        const callbackRef = useRef(onChange);
        const helpers = {
          reset() {
            callbackRef.current = console.log;
          },
        };
        helpers.reset = () => {};
        helpers.reset();
        const notify = callbackRef.current;
        useEffect(() => notify(buildPayload(value)), [value]);
        return null;
      };`,
  },
  {
    name: "ref snapshots after duplicate object methods ending in local callbacks",
    code: `import { useEffect, useRef, useState } from "react";
      const Child = ({ onChange }) => {
        const [value] = useState(0);
        const callbackRef = useRef(onChange);
        const helpers = {
          reset() {
            callbackRef.current = console.log;
          },
          reset() {},
        };
        helpers.reset();
        const notify = callbackRef.current;
        useEffect(() => notify(buildPayload(value)), [value]);
        return null;
      };`,
  },
  {
    name: "ref snapshots after duplicate class statics ending in local callbacks",
    code: `import { useEffect, useRef, useState } from "react";
      const Child = ({ onChange }) => {
        const [value] = useState(0);
        const callbackRef = useRef(onChange);
        class Helpers {
          static reset() {
            callbackRef.current = console.log;
          }
          static reset() {}
        }
        Helpers.reset();
        const notify = callbackRef.current;
        useEffect(() => notify(buildPayload(value)), [value]);
        return null;
      };`,
  },
  {
    name: "conditional callback aliases",
    code: `import { useEffect, useState } from "react";
      const Child = ({ onChange, onFallback, preferFallback }) => {
        const [value] = useState(0);
        const notify = preferFallback ? onFallback : onChange;
        useEffect(() => notify(buildPayload(value)), [notify, value]);
        return null;
      };`,
  },
  {
    name: "logical callback aliases",
    code: `import { useEffect, useState } from "react";
      const Child = ({ onChange, onFallback }) => {
        const [value] = useState(0);
        const notify = onChange || onFallback;
        useEffect(() => notify(buildPayload(value)), [notify, value]);
        return null;
      };`,
  },
  {
    name: "object-property callback aliases",
    code: `import { useEffect, useState } from "react";
      const Child = ({ onChange }) => {
        const [value] = useState(0);
        const callbacks = { notify: onChange };
        useEffect(() => callbacks.notify(buildPayload(value)), [callbacks, value]);
        return null;
      };`,
  },
  {
    name: "prop-initialized custom-hook state",
    code: `import { useEffect, useState } from "react";
      const useCounter = (initialValue) => {
        const [value] = useState(initialValue);
        return value;
      };
      const Child = ({ initialValue, onChange }) => {
        const value = useCounter(initialValue);
        useEffect(() => onChange(buildPayload(value)), [onChange, value]);
        return null;
      };`,
  },
  {
    name: "the React PhoneNr Input benchmark bypass",
    code: `import { useEffect, useRef } from "react";
      import { usePhonenumber } from "./use-phonenumber";
      const PhoneInput = ({ format, initialCountry, initialValue, onChange, withCountryMeta }) => {
        const { country, phoneNumber } = usePhonenumber({
          format,
          initialCountry,
          initialValue,
        });
        const onChangeRef = useRef(onChange);
        useEffect(() => {
          onChangeRef.current = onChange;
        }, [onChange]);
        useEffect(() => {
          const data = withCountryMeta ? { country, phoneNumber } : phoneNumber;
          onChangeRef.current(data);
        }, [country, phoneNumber, withCountryMeta]);
        return null;
      };`,
  },
];

const expectAllParentSyncRulesToReport = (code: string): void => {
  const results = [
    runRule(noPassDataToParent, code),
    runRule(noPassLiveStateToParent, code),
    runRule(noPropCallbackInEffect, code),
  ];
  for (const result of results) {
    expect(result.parseErrors).toEqual([]);
  }
  expect(results.map((result) => result.diagnostics.length)).toEqual([1, 1, 1]);
};

describe("parent-sync provenance matrix", () => {
  for (const testCase of mustReportCases) {
    it(`preserves ${testCase.name}`, () => {
      expectAllParentSyncRulesToReport(testCase.code);
    });
  }

  it("reports live state through unresolved non-ref current callbacks", () => {
    const code = `import { useEffect, useState } from "react";
      const Child = ({ onChange, onFallback, preferFallback }) => {
        const [value] = useState(0);
        const callbacks = preferFallback
          ? { current: onFallback }
          : { current: onChange };
        const notify = callbacks.current;
        useEffect(() => notify(buildPayload(value)), [notify, value]);
        return null;
      };`;
    const result = runRule(noPassLiveStateToParent, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  const mustNotReportCases: ParentSyncProvenanceCase[] = [
    {
      name: "userland useEffectEvent wrappers",
      code: `import { useEffect, useState } from "react";
        const useEffectEvent = (callback) => callback;
        const Child = ({ onChange }) => {
          const [value] = useState(0);
          const notify = useEffectEvent(onChange);
          useEffect(() => notify(buildPayload(value)), [notify, value]);
          return null;
        };`,
    },
    {
      name: "mutable callback aliases",
      code: `import { useEffect, useState } from "react";
        const Child = ({ onChange }) => {
          const [value] = useState(0);
          let notify = onChange;
          notify = console.log;
          useEffect(() => notify(buildPayload(value)), [notify, value]);
          return null;
        };`,
    },
    {
      name: "mixed parent and local callback branches",
      code: `import { useEffect, useState } from "react";
        const Child = ({ onChange, preferLocal }) => {
          const [value] = useState(0);
          const notify = preferLocal ? onChange : console.log;
          useEffect(() => notify(buildPayload(value)), [notify, value]);
          return null;
        };`,
    },
    {
      name: "local callback refs",
      code: `import { useEffect, useRef, useState } from "react";
        const Child = () => {
          const [value] = useState(0);
          const callbackRef = useRef(console.log);
          useEffect(() => callbackRef.current(buildPayload(value)), [value]);
          return null;
        };`,
    },
    {
      name: "parent callback refs overwritten with local callbacks",
      code: `import { useEffect, useRef, useState } from "react";
        const Child = ({ onChange }) => {
          const [value] = useState(0);
          const callbackRef = useRef(onChange);
          callbackRef.current = console.log;
          useEffect(() => callbackRef.current(buildPayload(value)), [value]);
          return null;
        };`,
    },
    {
      name: "parent callback refs overwritten through sibling aliases",
      code: `import { useEffect, useRef, useState } from "react";
        const Child = ({ onChange }) => {
          const [value] = useState(0);
          const callbackRef = useRef(onChange);
          const readAlias = callbackRef;
          const writeAlias = callbackRef;
          writeAlias.current = console.log;
          useEffect(() => readAlias.current(buildPayload(value)), [value]);
          return null;
        };`,
    },
    {
      name: "parent callback refs overwritten through transitive aliases",
      code: `import { useEffect, useRef, useState } from "react";
        const Child = ({ onChange }) => {
          const [value] = useState(0);
          const callbackRef = useRef(onChange);
          const readAlias = callbackRef;
          const firstWriteAlias = callbackRef;
          const secondWriteAlias = firstWriteAlias;
          secondWriteAlias.current = console.log;
          useEffect(() => readAlias.current(buildPayload(value)), [value]);
          return null;
        };`,
    },
    {
      name: "parent callback refs overwritten through mutable aliases",
      code: `import { useEffect, useRef, useState } from "react";
        const Child = ({ onChange }) => {
          const [value] = useState(0);
          const callbackRef = useRef(onChange);
          let callbackRefAlias = callbackRef;
          callbackRefAlias.current = console.log;
          useEffect(() => callbackRef.current(buildPayload(value)), [value]);
          return null;
        };`,
    },
    {
      name: "parent callback refs overwritten through typed receivers",
      code: `import { useEffect, useRef, useState } from "react";
        const Child = ({ onChange }) => {
          const [value] = useState(0);
          const callbackRef = useRef(onChange);
          (callbackRef as any).current = console.log;
          useEffect(() => callbackRef.current(buildPayload(value)), [value]);
          return null;
        };`,
    },
    {
      name: "parent callback refs passed to opaque mutation helpers",
      code: `import { useEffect, useRef, useState } from "react";
        const Child = ({ onChange }) => {
          const [value] = useState(0);
          const callbackRef = useRef(onChange);
          overwriteRef(callbackRef);
          useEffect(() => callbackRef.current(buildPayload(value)), [value]);
          return null;
        };`,
    },
    {
      name: "parent callback refs passed to Object.assign",
      code: `import { useEffect, useRef, useState } from "react";
        const Child = ({ onChange }) => {
          const [value] = useState(0);
          const callbackRef = useRef(onChange);
          Object.assign(callbackRef, { current: console.log });
          useEffect(() => callbackRef.current(buildPayload(value)), [value]);
          return null;
        };`,
    },
    {
      name: "parent callback refs exposed through useImperativeHandle",
      code: `import { useEffect, useImperativeHandle, useRef, useState } from "react";
        const Child = ({ forwardedRef, onChange }) => {
          const [value] = useState(0);
          const callbackRef = useRef(onChange);
          useImperativeHandle(forwardedRef, () => callbackRef);
          useEffect(() => callbackRef.current(buildPayload(value)), [value]);
          return null;
        };`,
    },
    {
      name: "ref-current callback snapshots after local overwrites",
      code: `import { useEffect, useRef, useState } from "react";
        const Child = ({ onChange }) => {
          const [value] = useState(0);
          const callbackRef = useRef(onChange);
          callbackRef.current = console.log;
          const notify = callbackRef.current;
          useEffect(() => notify(buildPayload(value)), [value]);
          return null;
        };`,
    },
    {
      name: "ref-current callback snapshots after invoked hoisted resets",
      code: `import { useEffect, useRef, useState } from "react";
        const Child = ({ onChange }) => {
          const [value] = useState(0);
          const callbackRef = useRef(onChange);
          reset();
          const notify = callbackRef.current;
          function reset() {
            callbackRef.current = console.log;
          }
          useEffect(() => notify(buildPayload(value)), [value]);
          return null;
        };`,
    },
    {
      name: "ref-current callback snapshots after call-invoked resets",
      code: `import { useEffect, useRef, useState } from "react";
        const Child = ({ onChange }) => {
          const [value] = useState(0);
          const callbackRef = useRef(onChange);
          const reset = () => {
            callbackRef.current = console.log;
          };
          reset.call(null);
          const notify = callbackRef.current;
          useEffect(() => notify(buildPayload(value)), [value]);
          return null;
        };`,
    },
    {
      name: "ref-current callback snapshots after apply-invoked resets",
      code: `import { useEffect, useRef, useState } from "react";
        const Child = ({ onChange }) => {
          const [value] = useState(0);
          const callbackRef = useRef(onChange);
          const reset = () => {
            callbackRef.current = console.log;
          };
          reset.apply(null, []);
          const notify = callbackRef.current;
          useEffect(() => notify(buildPayload(value)), [value]);
          return null;
        };`,
    },
    {
      name: "ref-current callback snapshots after bind-invoked resets",
      code: `import { useEffect, useRef, useState } from "react";
        const Child = ({ onChange }) => {
          const [value] = useState(0);
          const callbackRef = useRef(onChange);
          const reset = () => {
            callbackRef.current = console.log;
          };
          reset.bind(null)();
          const notify = callbackRef.current;
          useEffect(() => notify(buildPayload(value)), [value]);
          return null;
        };`,
    },
    {
      name: "ref-current callback snapshots after stored bound resets",
      code: `import { useEffect, useRef, useState } from "react";
        const Child = ({ onChange }) => {
          const [value] = useState(0);
          const callbackRef = useRef(onChange);
          const reset = () => {
            callbackRef.current = console.log;
          };
          const boundReset = reset.bind(null);
          boundReset();
          const notify = callbackRef.current;
          useEffect(() => notify(buildPayload(value)), [value]);
          return null;
        };`,
    },
    {
      name: "ref-current callback snapshots after object method resets",
      code: `import { useEffect, useRef, useState } from "react";
        const Child = ({ onChange }) => {
          const [value] = useState(0);
          const callbackRef = useRef(onChange);
          const helpers = {
            reset() {
              callbackRef.current = console.log;
            },
          };
          helpers.reset();
          const notify = callbackRef.current;
          useEffect(() => notify(buildPayload(value)), [value]);
          return null;
        };`,
    },
    {
      name: "ref-current callback snapshots after overwritten object method resets",
      code: `import { useEffect, useRef, useState } from "react";
        const Child = ({ onChange }) => {
          const [value] = useState(0);
          const callbackRef = useRef(onChange);
          const helpers = {
            reset() {},
          };
          helpers.reset = () => {
            callbackRef.current = console.log;
          };
          helpers.reset();
          const notify = callbackRef.current;
          useEffect(() => notify(buildPayload(value)), [value]);
          return null;
        };`,
    },
    {
      name: "ref-current callback snapshots after computed object method resets",
      code: `import { useEffect, useRef, useState } from "react";
        const Child = ({ onChange }) => {
          const [value] = useState(0);
          const callbackRef = useRef(onChange);
          const helpers = {
            reset() {},
          };
          const resetKey = "reset";
          helpers[resetKey] = () => {
            callbackRef.current = console.log;
          };
          helpers.reset();
          const notify = callbackRef.current;
          useEffect(() => notify(buildPayload(value)), [value]);
          return null;
        };`,
    },
    {
      name: "ref-current callback snapshots after dynamic object method resets",
      code: `import { useEffect, useRef, useState } from "react";
        const Child = ({ onChange, resetKey }) => {
          const [value] = useState(0);
          const callbackRef = useRef(onChange);
          const helpers = {
            reset() {},
          };
          helpers[resetKey] = () => {
            callbackRef.current = console.log;
          };
          helpers.reset();
          const notify = callbackRef.current;
          useEffect(() => notify(buildPayload(value)), [value]);
          return null;
        };`,
    },
    {
      name: "ref-current callback snapshots after dynamic object method replacements",
      code: `import { useEffect, useRef, useState } from "react";
        const Child = ({ onChange, resetKey }) => {
          const [value] = useState(0);
          const callbackRef = useRef(onChange);
          const helpers = {
            reset() {
              callbackRef.current = console.log;
            },
          };
          helpers[resetKey] = () => {};
          helpers.reset();
          const notify = callbackRef.current;
          useEffect(() => notify(buildPayload(value)), [value]);
          return null;
        };`,
    },
    {
      name: "ref-current callback snapshots after duplicate object method resets",
      code: `import { useEffect, useRef, useState } from "react";
        const Child = ({ onChange }) => {
          const [value] = useState(0);
          const callbackRef = useRef(onChange);
          const helpers = {
            reset() {},
            reset() {
              callbackRef.current = console.log;
            },
          };
          helpers.reset();
          const notify = callbackRef.current;
          useEffect(() => notify(buildPayload(value)), [value]);
          return null;
        };`,
    },
    {
      name: "ref-current callback snapshots after class static resets",
      code: `import { useEffect, useRef, useState } from "react";
        const Child = ({ onChange }) => {
          const [value] = useState(0);
          const callbackRef = useRef(onChange);
          class Helpers {
            static reset() {
              callbackRef.current = console.log;
            }
          }
          Helpers.reset();
          const notify = callbackRef.current;
          useEffect(() => notify(buildPayload(value)), [value]);
          return null;
        };`,
    },
    {
      name: "ref-current callback snapshots after overwritten class static resets",
      code: `import { useEffect, useRef, useState } from "react";
        const Child = ({ onChange }) => {
          const [value] = useState(0);
          const callbackRef = useRef(onChange);
          class Helpers {
            static reset() {}
          }
          Helpers.reset = () => {
            callbackRef.current = console.log;
          };
          Helpers.reset();
          const notify = callbackRef.current;
          useEffect(() => notify(buildPayload(value)), [value]);
          return null;
        };`,
    },
    {
      name: "ref-current callback snapshots after duplicate class static resets",
      code: `import { useEffect, useRef, useState } from "react";
        const Child = ({ onChange }) => {
          const [value] = useState(0);
          const callbackRef = useRef(onChange);
          class Helpers {
            static reset() {}
            static reset() {
              callbackRef.current = console.log;
            }
          }
          Helpers.reset();
          const notify = callbackRef.current;
          useEffect(() => notify(buildPayload(value)), [value]);
          return null;
        };`,
    },
    {
      name: "ref-current callback snapshots after aliased resets",
      code: `import { useEffect, useRef, useState } from "react";
        const Child = ({ onChange }) => {
          const [value] = useState(0);
          const callbackRef = useRef(onChange);
          const reset = () => {
            callbackRef.current = console.log;
          };
          const executeReset = reset;
          executeReset();
          const notify = callbackRef.current;
          useEffect(() => notify(buildPayload(value)), [value]);
          return null;
        };`,
    },
    {
      name: "ref-current callback snapshots after conditional resets",
      code: `import { useEffect, useRef, useState } from "react";
        const Child = ({ onChange, shouldReset }) => {
          const [value] = useState(0);
          const callbackRef = useRef(onChange);
          const reset = () => {
            callbackRef.current = console.log;
          };
          if (shouldReset) reset();
          const notify = callbackRef.current;
          useEffect(() => notify(buildPayload(value)), [value]);
          return null;
        };`,
    },
    {
      name: "ref-current callback snapshots after IIFE resets",
      code: `import { useEffect, useRef, useState } from "react";
        const Child = ({ onChange }) => {
          const [value] = useState(0);
          const callbackRef = useRef(onChange);
          (() => {
            callbackRef.current = console.log;
          })();
          const notify = callbackRef.current;
          useEffect(() => notify(buildPayload(value)), [value]);
          return null;
        };`,
    },
    {
      name: "callback refs listed in imported lookalike hook alias dependency arrays",
      code: `import { useStableMemo as importedMemo } from "custom-hooks";
        import { useEffect, useRef, useState } from "react";
        const useStableMemo = importedMemo;
        const Child = ({ onChange }) => {
          const [value] = useState(0);
          const callbackRef = useRef(onChange);
          useStableMemo(() => callbackRef.current, [callbackRef]);
          useEffect(() => callbackRef.current(buildPayload(value)), [value]);
          return null;
        };`,
    },
  ];

  for (const testCase of mustNotReportCases) {
    it(`rejects ${testCase.name}`, () => {
      const results = [
        runRule(noPassDataToParent, testCase.code),
        runRule(noPassLiveStateToParent, testCase.code),
        runRule(noPropCallbackInEffect, testCase.code),
      ];
      for (const result of results) {
        expect(result.parseErrors).toEqual([]);
        expect(result.diagnostics).toEqual([]);
      }
    });
  }
});
