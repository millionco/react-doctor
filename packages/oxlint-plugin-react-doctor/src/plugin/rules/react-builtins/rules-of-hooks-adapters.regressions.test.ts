import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rulesOfHooks } from "./rules-of-hooks.js";

describe("react-builtins/rules-of-hooks — typed Hook adapters", () => {
  it("accepts the pinned alova React StatesHook adapter", () => {
    const result = runRule(
      rulesOfHooks,
      `
        import { falseValue, isNumber, noop, undefinedValue } from "@alova/shared";
        import { StatesHook } from "alova";
        import { MutableRefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
        import { ReactHookExportType, ReactState } from "~/typings/stateshook/react";

        const stateToData = <D>(reactState: ReactState<D>) => (2 in reactState ? reactState[2] : reactState[0]);
        const refCurrent = <T>(ref: MutableRefObject<T>) => ref.current;
        const setRef = <T>(ref: MutableRefObject<T>, newVal: T) => {
          ref.current = newVal;
        };

        export default {
          name: "React",
          create: initialValue => useState(initialValue),
          export: stateToData,
          dehydrate: stateToData,
          update: (newVal, state) => {
            state[2] = newVal;
            state[1](newVal);
          },
          memorize: fn => {
            const fnRef = useRef(noop as typeof fn);
            setRef(fnRef, fn);
            return useCallback((...args: any[]) => refCurrent(fnRef)(...args), []);
          },
          ref: initialValue => {
            const refObj = useRef(initialValue);
            refCurrent(refObj) === undefinedValue && setRef(refObj, initialValue);
            return refObj;
          },
          effectRequest({ handler, removeStates, immediate, watchingStates = [] }) {
            const oldStates = useRef(watchingStates);

            useEffect(() => {
              const oldStatesValue = refCurrent(oldStates);
              let changedIndex: number | undefined = undefinedValue;
              for (const index in watchingStates) {
                if (!Object.is(oldStatesValue[index], watchingStates[index])) {
                  changedIndex = Number(index);
                  break;
                }
              }
              setRef(oldStates, watchingStates);
              if (immediate || isNumber(changedIndex)) {
                handler(changedIndex);
              }
            }, watchingStates);

            useEffect(() => removeStates, []);
          },
          computed: (getter, depList) => {
            const memo = useMemo(getter, depList);
            return [memo, noop];
          },
          watch: (states, callback) => {
            const needEmit = useRef(falseValue);
            useEffect(() => {
              needEmit.current ? callback() : (needEmit.current = true);
            }, states);
          },
          onMounted: callback => {
            useEffect(callback, []);
          },
          onUnmounted: callback => {
            useEffect(() => callback, []);
          }
        } as StatesHook<ReactHookExportType<unknown>>;
      `,
      { filename: "packages/client/src/statesHook/react.ts" },
    );

    expect(result.diagnostics).toEqual([]);
  });
});
