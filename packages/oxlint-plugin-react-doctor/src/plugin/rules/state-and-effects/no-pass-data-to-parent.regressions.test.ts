import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noPassDataToParent } from "./no-pass-data-to-parent.js";

describe("no-pass-data-to-parent — regressions", () => {
  describe("router / namespaced API receivers", () => {
    it("stays silent on a destructured router prop redirecting in a useEffect (ant-design .dumi/pages/404 shape)", () => {
      const result = runRule(
        noPassDataToParent,
        `const NotFoundPage = ({ router }) => {
          useEffect(() => {
            router.replace(utils.getLocalizedPathname("/", isZhCN(location.pathname)).pathname);
          }, []);
          return null;
        };`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("stays silent on the member-form router receiver (props.router.replace)", () => {
      const result = runRule(
        noPassDataToParent,
        `const NotFoundPage = (props) => {
          useEffect(() => {
            props.router.replace(utils.getLocalizedPathname("/", true).pathname);
          }, []);
          return null;
        };`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("still flags props.onLoaded(fetchedData) — member-form parent callback", () => {
      const result = runRule(
        noPassDataToParent,
        `const Child = (props) => {
          const fetchedData = useSomeAPI();
          useEffect(() => {
            props.onLoaded(fetchedData);
          }, [props, fetchedData]);
          return null;
        };`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics.length).toBeGreaterThan(0);
    });

    it("still flags a destructured identifier-form parent callback (onChange(computed))", () => {
      const result = runRule(
        noPassDataToParent,
        `const Child = ({ onChange }) => {
          const computed = useSomeAPI();
          useEffect(() => {
            onChange(computed);
          }, [onChange, computed]);
          return null;
        };`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics.length).toBeGreaterThan(0);
    });
  });

  describe("string-read method names on the props object", () => {
    it("still flags props.search(results) — a parent callback named like String.prototype.search", () => {
      const result = runRule(
        noPassDataToParent,
        `const Child = (props) => {
          const results = computeResults();
          useEffect(() => {
            props.search(results);
          }, [props, results]);
          return null;
        };`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics.length).toBeGreaterThan(0);
    });

    it("stays silent on a string read from a nested prop value (props.path.includes)", () => {
      const result = runRule(
        noPassDataToParent,
        `const Child = (props) => {
          const separator = computeSeparator();
          useEffect(() => {
            if (props.path.includes(separator)) {
              console.log("nested");
            }
          }, [props.path, separator]);
          return null;
        };`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("stays silent on a string read from a destructured prop value (text.startsWith)", () => {
      const result = runRule(
        noPassDataToParent,
        `const Child = ({ text }) => {
          const computedPrefix = computePrefix();
          useEffect(() => {
            if (text.startsWith(computedPrefix)) {
              console.log("prefixed");
            }
          }, [text, computedPrefix]);
          return null;
        };`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });
  });

  describe("undefined argument guard", () => {
    it("stays silent on onReset(undefined) — an imperative clear, not data", () => {
      const result = runRule(
        noPassDataToParent,
        `function Child({ onReset }) {
          useEffect(() => {
            onReset(undefined);
          }, [onReset]);
          return null;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("still flags an unresolved global identifier argument — pins that the guard matches only the name `undefined`", () => {
      const result = runRule(
        noPassDataToParent,
        `function Child({ onReset }) {
          useEffect(() => {
            onReset(ambientGlobalValue);
          }, [onReset]);
          return null;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics.length).toBeGreaterThan(0);
    });
  });

  describe("local utilities misidentified as parent callbacks (verification run)", () => {
    it("stays silent on setValue destructured from useForm (hyperdx DBDashboardImportPage)", () => {
      const result = runRule(
        noPassDataToParent,
        `function ImportPage({ initialConfig }) {
          const { setValue, watch } = useForm({ defaultValues: initialConfig });
          const source = watch('source');
          useEffect(() => {
            if (source) {
              setValue('table', source.table);
              setValue('where', '');
            }
          }, [source]);
          return null;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("stays silent on a setter returned by a sibling hook (jumper MultiSelect)", () => {
      const result = runRule(
        noPassDataToParent,
        `const MultiSelect = ({ selected }) => {
          const { setValue, value } = useSelect({ initial: selected });
          useEffect(() => {
            setValue(selected);
          }, [selected]);
          return null;
        };`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("stays silent on a local wrapper that calls a prop internally (jumper useTransactionFlow)", () => {
      const result = runRule(
        noPassDataToParent,
        `function Flow({ onSuccess }) {
          const [step, setStep] = useState(0);
          const executeAction = useCallback(async () => {
            const result = await run(step);
            onSuccess?.(result);
          }, [step, onSuccess]);
          useEffect(() => {
            executeAction();
          }, [step]);
          return null;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("stays silent on a useState setter seeded from a prop (cloudscape pagination)", () => {
      const result = runRule(
        noPassDataToParent,
        `function Pagination({ currentPageIndex }) {
          const [jumpToPageValue, setJumpToPageValue] = useState(currentPageIndex);
          const [dirty, setDirty] = useState(false);
          useEffect(() => {
            setJumpToPageValue(computeJump(dirty));
          }, [dirty]);
          return null;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });
  });

  describe("registration / subscription and external instances (verification run)", () => {
    it("stays silent on sensor subscription with a concise-body cleanup (lightbox usePointerEvents)", () => {
      const result = runRule(
        noPassDataToParent,
        `export function usePointerEvents(subscribeSensors, onPointerDown, onPointerMove, onPointerUp, disabled) {
          React.useEffect(
            () =>
              !disabled
                ? cleanup(
                    subscribeSensors(EVENT_ON_POINTER_DOWN, onPointerDown),
                    subscribeSensors(EVENT_ON_POINTER_MOVE, onPointerMove),
                    subscribeSensors(EVENT_ON_POINTER_UP, onPointerUp),
                  )
                : () => {},
            [subscribeSensors, onPointerDown, onPointerMove, onPointerUp, disabled],
          );
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("stays silent on registration of a prop key plus a local callback (data flows down)", () => {
      const result = runRule(
        noPassDataToParent,
        `function Field({ register, name }) {
          const validate = useCallback(() => true, []);
          useEffect(() => {
            register(name, validate);
          }, [register, name]);
          return null;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("stays silent on method calls on a positional custom-hook parameter (aws graph-explorer cy.batch)", () => {
      const result = runRule(
        noPassDataToParent,
        `export function useRunLayout(cy, layoutName, nodes) {
          useEffect(() => {
            cy.batch(() => {
              nodes.forEach((n) => n.lock());
            });
          }, [cy, layoutName]);
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("stays silent on redux fetch-dispatch props (jaeger ServicesView)", () => {
      const result = runRule(
        noPassDataToParent,
        `function ServicesView({ fetchAllServiceMetrics, selectedService }) {
          const [range, setRange] = useState(null);
          useEffect(() => {
            fetchAllServiceMetrics(selectedService, range);
          }, [selectedService, range]);
          return null;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });
  });

  it("still flags a custom-hook callback parameter receiving hook data", () => {
    const result = runRule(
      noPassDataToParent,
      `function useThing(onResult) {
        const value = useSomeAPI();
        useEffect(() => {
          onResult(value);
        }, [value]);
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a prop alias destructured from the props object", () => {
    const result = runRule(
      noPassDataToParent,
      `const Child = (props) => {
        const { onChange } = props;
        const computed = useSomeAPI();
        useEffect(() => {
          onChange(computed);
        }, [onChange, computed]);
        return null;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags handing hook-fetched data back to the parent", () => {
    const result = runRule(
      noPassDataToParent,
      `const Child = ({ onFetched }) => {
        const data = useSomeAPI();
        useEffect(() => {
          onFetched(data);
        }, [onFetched, data]);
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
