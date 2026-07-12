import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noPassDataToParent } from "./no-pass-data-to-parent.js";

describe("no-pass-data-to-parent — regressions", () => {
  describe("external subscription notifications", () => {
    it("stays silent when notifying a parent of a media-query hook transition", () => {
      const result = runRule(
        noPassDataToParent,
        `const Sidebar = ({ onBreakPoint }) => {
          const broken = useMediaQuery("(max-width: 768px)");
          const previousBroken = useRef(broken);
          useEffect(() => {
            if (previousBroken.current !== broken) {
              previousBroken.current = broken;
              onBreakPoint(broken);
            }
          }, [broken, onBreakPoint]);
          return null;
        };`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("stays silent when notifying a parent of state driven only by matchMedia", () => {
      const result = runRule(
        noPassDataToParent,
        `const Sidebar = ({ onBreakPoint }) => {
          const [broken, setBroken] = useState(false);
          useEffect(() => {
            const query = window.matchMedia("(max-width: 768px)");
            const update = (event) => setBroken(event.matches);
            query.addEventListener("change", update);
            return () => query.removeEventListener("change", update);
          }, []);
          useEffect(() => {
            const currentBroken = broken;
            onBreakPoint(currentBroken);
          }, [broken, onBreakPoint]);
          return null;
        };`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("still flags ordinary child-owned form state passed to a parent", () => {
      const result = runRule(
        noPassDataToParent,
        `const Form = ({ onChange }) => {
          const value = useFormValue();
          useEffect(() => {
            onChange(value);
          }, [value, onChange]);
          return <input value={value} />;
        };`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });
  });

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

    it("still flags a member-form parent callback whose `props` receiver is wrapped in `as any`", () => {
      const result = runRule(
        noPassDataToParent,
        `const Child = (props) => {
          const fetchedData = useSomeAPI();
          useEffect(() => {
            (props as any).onLoaded(fetchedData);
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

  describe("delta audit vs 0.7.1", () => {
    it("stays silent when an imperative handler bag is registered with the parent (freecut timeline-content onZoomHandlersReady)", () => {
      const result = runRule(
        noPassDataToParent,
        `const TimelineContent = memo(function TimelineContent({ onZoomHandlersReady }) {
          const handleZoomChange = useCallback((zoom) => applyZoom(zoom), []);
          const handleZoomIn = useCallback(() => applyZoom(1), []);
          const handleZoomOut = useCallback(() => applyZoom(-1), []);
          useEffect(() => {
            if (onZoomHandlersReady) {
              onZoomHandlersReady({ handleZoomChange, handleZoomIn, handleZoomOut });
            }
          }, [handleZoomChange, handleZoomIn, handleZoomOut, onZoomHandlersReady]);
          return null;
        });`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("stays silent when a wrapper-hook accessor factory only reads props (jaeger VirtualizedTraceView registerAccessors)", () => {
      const result = runRule(
        noPassDataToParent,
        `const VirtualizedTraceViewImpl = memo(function VirtualizedTraceViewImpl(props) {
          const listViewRef = useRef(null);
          const getViewRange = useCallback(() => props.viewRange, [props.viewRange]);
          const getAccessors = useCallback(() => {
            const lv = listViewRef.current;
            if (!lv) {
              throw new Error("ListView unavailable");
            }
            return { getViewRange, getViewHeight: lv.getViewHeight };
          }, [getViewRange]);
          const { registerAccessors } = props;
          const prevRegisterAccessorsRef = useRef(registerAccessors);
          useEffect(() => {
            if (registerAccessors !== prevRegisterAccessorsRef.current) {
              prevRegisterAccessorsRef.current = registerAccessors;
              if (listViewRef.current) {
                registerAccessors(getAccessors());
              }
            }
          }, [registerAccessors, getAccessors]);
          return null;
        });`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("stays silent when hook-owned interaction state from a parent-wired hook is bridged up (freecut TimelineMarqueeLayer)", () => {
      const result = runRule(
        noPassDataToParent,
        `const TimelineMarqueeLayer = memo(function TimelineMarqueeLayer({
          containerRef,
          itemIds,
          onSelectionChange,
          onMarqueeActiveChange,
        }) {
          const marqueeItems = useMemo(() => itemIds.map((id) => ({ id })), [itemIds]);
          const { marquee, isActive } = useMarqueeSelection({
            containerRef,
            items: marqueeItems,
            onSelectionChange,
            enabled: itemIds.length > 0,
          });
          useEffect(() => {
            onMarqueeActiveChange(isActive);
          }, [isActive, onMarqueeActiveChange]);
          return null;
        });`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("still flags a functional updater injecting generated data into a parent setter (bulwarkmail SecurityStep)", () => {
      const result = runRule(
        noPassDataToParent,
        `function generateSessionSecret() {
          const bytes = new Uint8Array(32);
          crypto.getRandomValues(bytes);
          return String(bytes);
        }
        function SecurityStep({ config, setConfig }) {
          useEffect(() => {
            if (!config.sessionSecret) {
              setConfig((prev) => ({ ...prev, sessionSecret: generateSessionSecret() }));
            }
          }, []);
          return null;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics.length).toBeGreaterThan(0);
    });

    it("stays silent on a mirror-only functional updater (no child-generated data)", () => {
      const result = runRule(
        noPassDataToParent,
        `function SecurityStep({ config, setConfig }) {
          useEffect(() => {
            if (!config.enabled) {
              setConfig((prev) => ({ ...prev, enabled: true }));
            }
          }, []);
          return null;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("still flags a useStableCallback wrapper that notifies the parent (cloudscape classic.tsx)", () => {
      const result = runRule(
        noPassDataToParent,
        `const ClassicAppLayout = ({ isMobile, onNavigationChange, navigationOpen }) => {
          const { setFocus: focusNavButtons } = useFocusControl(navigationOpen);
          const onNavigationToggle = useStableCallback(({ isOpen, autoFocus }) => {
            focusNavButtons({ force: false, autoFocus });
            fireNonCancelableEvent(onNavigationChange, { open: isOpen });
          });
          useEffect(() => {
            if (isMobile) {
              onNavigationToggle({ isOpen: false, autoFocus: false });
            }
          }, [isMobile, onNavigationToggle]);
          return null;
        };`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics.length).toBeGreaterThan(0);
    });

    it("still flags a parent onChange receiving values computed from state through a helper (cloudscape custom-forms)", () => {
      const result = runRule(
        noPassDataToParent,
        `function parseValue(value, defaultTime) {
          const [dateValue = '', timeValue = ''] = value.split('T');
          return { dateValue, timeValue: timeValue || defaultTime || '' };
        }
        export function DateTimeForm({ filter, operator, value, onChange }) {
          const defaultTime = operator === '<' || operator === '>=' ? undefined : '23:59:59';
          const [{ dateValue, timeValue }, setState] = useState(parseValue(value ?? '', defaultTime));
          useEffect(
            () => {
              const dateAndTimeValue = dateValue + 'T' + (timeValue || '00:00:00');
              if (!dateValue.trim()) {
                onChange(null);
              } else if (isValidIsoDate(dateAndTimeValue)) {
                onChange(dateAndTimeValue);
              }
            },
            [dateValue, timeValue]
          );
          return null;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics.length).toBeGreaterThan(0);
    });

    it("stays silent when a renderTile prop draws into a child-owned canvas context (freecut tiled-canvas)", () => {
      const result = runRule(
        noPassDataToParent,
        `const TiledCanvas = memo(function TiledCanvas({ renderTile, width, height, version }) {
          const containerRef = useRef(null);
          useEffect(() => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            if (ctx) {
              renderTile(ctx, 0, 0, width);
            }
          }, [renderTile, width, height, version]);
          return null;
        });`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });
  });

  describe("docs-validation round 2", () => {
    it("stays silent when a parent-wired hook result reaches the callback through a derived local (PortOS MediaJobThumb)", () => {
      const result = runRule(
        noPassDataToParent,
        `import useMediaJobProgress from '../../hooks/useMediaJobProgress';
        function MediaJobThumb({ jobId, kind, onFilename, fallbackFilename }) {
          const hasStaticFallback = !!fallbackFilename && kind === 'image';
          const liveJobId = hasStaticFallback ? null : jobId;
          const { status, filename } = useMediaJobProgress(liveJobId, { kind });
          const effectiveFilename = hasStaticFallback ? fallbackFilename : filename;
          useEffect(() => {
            if (onFilename && effectiveFilename) onFilename(effectiveFilename);
          }, [effectiveFilename, onFilename]);
          return null;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("still flags a derived local computed from a hook NOT wired to props", () => {
      const result = runRule(
        noPassDataToParent,
        `import useJobFeed from '../../hooks/useJobFeed';
        function JobThumb({ onFilename }) {
          const { filename } = useJobFeed();
          const effectiveFilename = filename || 'unknown';
          useEffect(() => {
            if (onFilename && effectiveFilename) onFilename(effectiveFilename);
          }, [effectiveFilename, onFilename]);
          return null;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics.length).toBeGreaterThan(0);
    });
  });

  describe("callback refs sourced from parent callbacks (FN-024)", () => {
    it("flags the PhoneInput ref-laundering shape with an initializer and render assignment", () => {
      const result = runRule(
        noPassDataToParent,
        `function PhoneInput({ onChange, country, phoneNumber, withCountryMeta }) {
          const onChangeRef = useRef(onChange);
          onChangeRef.current = onChange;
          const data = toPhoneNumber(phoneNumber, country, withCountryMeta);
          useEffect(() => {
            onChangeRef.current(data);
          }, [country, phoneNumber, withCountryMeta]);
          return null;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("flags a wrapped static-computed current call after a dominating props-member assignment", () => {
      const result = runRule(
        noPassDataToParent,
        `const PhoneInput = (props) => {
          const onChangeRef = React.useRef();
          (onChangeRef as { current?: typeof props.onChange })["current"] = props.onChange;
          const data = buildPhoneData();
          useEffect(() => {
            ((onChangeRef as { current: typeof props.onChange })["current"] as typeof props.onChange)(data);
          }, [data]);
          return null;
        };`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("flags optional calls through immutable callback and ref alias chains", () => {
      const result = runRule(
        noPassDataToParent,
        `import { useRef as useReactRef } from "react";
        const PhoneInput = ({ onChange: notifyChange }) => {
          const parentCallback = notifyChange;
          const callbackRef = useReactRef(parentCallback);
          const callbackRefAlias = callbackRef;
          const latestCallbackRef = callbackRefAlias;
          const childData = buildPhoneData();
          useEffect(() => {
            latestCallbackRef["current"]?.(childData);
          }, [childData]);
          return null;
        };`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("flags render assignments after effect registration and parent-callback reassignment", () => {
      const result = runRule(
        noPassDataToParent,
        `function PhoneInput({ onChange, onCommit }) {
          const callbackRef = useRef();
          const childData = buildPhoneData();
          useEffect(() => {
            callbackRef.current(childData);
          }, [childData]);
          callbackRef.current = onChange;
          callbackRef.current = onCommit;
          return null;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("flags refs created through an immutable React namespace alias", () => {
      const result = runRule(
        noPassDataToParent,
        `import ReactClient from "react";
        const ReactAlias = ReactClient;
        function PhoneInput({ onChange }) {
          const callbackRef = ReactAlias.useRef(onChange);
          const childData = buildPhoneData();
          useEffect(() => {
            callbackRef.current(childData);
          }, [childData]);
          return null;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("preserves useEffectEvent callback tracing", () => {
      const result = runRule(
        noPassDataToParent,
        `function PhoneInput({ onChange, phoneNumber }) {
          const notifyChange = useEffectEvent(() => {
            onChange(toPhoneNumber(phoneNumber));
          });
          useEffect(() => {
            notifyChange();
          }, [notifyChange]);
          return null;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("stays silent for DOM refs and callback object bags", () => {
      const result = runRule(
        noPassDataToParent,
        `function PhoneInput({ onChange, childData }) {
          const inputRef = useRef(null);
          const callbacksRef = useRef({ onChange });
          useEffect(() => {
            inputRef.current?.focus();
            callbacksRef.current.onChange(childData);
          }, [childData]);
          return <input ref={inputRef} />;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("stays silent for a ref initialized from a local callback or opaque wrapper", () => {
      const result = runRule(
        noPassDataToParent,
        `function PhoneInput({ onChange, childData }) {
          const localCallback = (data) => log(data);
          const localCallbackRef = useRef(localCallback);
          const opaqueCallbackRef = useLatestCallback(onChange);
          useEffect(() => {
            localCallbackRef.current(childData);
            opaqueCallbackRef.current(childData);
          }, [childData]);
          return null;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("stays silent when mutable callback aliases or ref aliases lose parent provenance", () => {
      const result = runRule(
        noPassDataToParent,
        `function PhoneInput({ onChange, childData }) {
          const localCallback = (data) => log(data);
          let callbackAlias = onChange;
          callbackAlias = localCallback;
          const mutableCallbackRef = useRef(callbackAlias);
          const aliasedRef = useRef(onChange);
          const refAlias = aliasedRef;
          refAlias.current = localCallback;
          useEffect(() => {
            mutableCallbackRef.current(childData);
            aliasedRef.current(childData);
          }, [childData]);
          return null;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("stays silent for a shadowed useRef implementation", () => {
      const result = runRule(
        noPassDataToParent,
        `const useRef = (value) => ({ current: value });
        function PhoneInput({ onChange, childData }) {
          const callbackRef = useRef(onChange);
          useEffect(() => {
            callbackRef.current(childData);
          }, [childData]);
          return null;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("stays silent when React or an aliased React namespace is shadowed", () => {
      const result = runRule(
        noPassDataToParent,
        `function PhoneInput({ onChange, childData }) {
          const React = { useRef: (value) => ({ current: value }) };
          const ReactAlias = React;
          const callbackRef = ReactAlias.useRef(onChange);
          useEffect(() => {
            callbackRef.current(childData);
          }, [childData]);
          return null;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("stays silent for conditional and mixed current assignments", () => {
      const result = runRule(
        noPassDataToParent,
        `function PhoneInput({ onChange, childData, disabled }) {
          const localCallback = (data) => log(data);
          const conditionalRef = useRef();
          if (!disabled) conditionalRef.current = onChange;
          const mixedRef = useRef(onChange);
          mixedRef.current = onChange;
          if (disabled) mixedRef.current = localCallback;
          const dynamicRef = useRef(onChange);
          dynamicRef[disabled ? "current" : "fallback"] = localCallback;
          useEffect(() => {
            conditionalRef.current(childData);
            mixedRef.current(childData);
            dynamicRef.current(childData);
          }, [childData, disabled]);
          return null;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("stays silent for imperative-handle and opaque ref-object mutation", () => {
      const imperativeHandleResult = runRule(
        noPassDataToParent,
        `function PhoneInput({ onChange, childData }) {
          const localCallback = (data) => log(data);
          const callbackRef = useRef(onChange);
          useImperativeHandle(callbackRef, () => localCallback, [localCallback]);
          useEffect(() => {
            callbackRef.current(childData);
          }, [childData]);
          return null;
        }`,
      );
      const opaqueMutationResult = runRule(
        noPassDataToParent,
        `function PhoneInput({ onChange, childData }) {
          const callbackRef = useRef(onChange);
          synchronizeCallbackRef(callbackRef);
          useEffect(() => {
            callbackRef.current(childData);
          }, [childData]);
          return null;
        }`,
      );
      expect(imperativeHandleResult.parseErrors).toEqual([]);
      expect(imperativeHandleResult.diagnostics).toEqual([]);
      expect(opaqueMutationResult.parseErrors).toEqual([]);
      expect(opaqueMutationResult.diagnostics).toEqual([]);
    });

    it("stays silent for event-time assignments and event-handler calls", () => {
      const result = runRule(
        noPassDataToParent,
        `function PhoneInput({ onChange, childData }) {
          const callbackRef = useRef();
          const handleClick = () => {
            callbackRef.current = onChange;
            callbackRef.current(childData);
          };
          useEffect(() => {
            window.addEventListener("click", handleClick);
            return () => window.removeEventListener("click", handleClick);
          }, [handleClick]);
          return <button onClick={handleClick}>Notify</button>;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("stays silent for dynamic current access and destructive updates", () => {
      const result = runRule(
        noPassDataToParent,
        `function PhoneInput({ onChange, childData, currentKey }) {
          const dynamicRef = useRef(onChange);
          const updatedRef = useRef(onChange);
          updatedRef.current++;
          useEffect(() => {
            dynamicRef[currentKey](childData);
            updatedRef.current(childData);
          }, [childData, currentKey]);
          return null;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("stays silent for deferred and nested assignments", () => {
      const result = runRule(
        noPassDataToParent,
        `function PhoneInput({ onChange, childData }) {
          const deferredRef = useRef();
          const nestedRef = useRef();
          const syncNestedRef = () => {
            nestedRef.current = onChange;
          };
          syncNestedRef();
          useEffect(() => {
            deferredRef.current = onChange;
            deferredRef.current(childData);
            nestedRef.current(childData);
          }, [childData]);
          return null;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("stays silent for deferred calls and calls outside effects", () => {
      const result = runRule(
        noPassDataToParent,
        `function PhoneInput({ onChange, childData }) {
          const callbackRef = useRef(onChange);
          callbackRef.current(childData);
          useEffect(() => {
            setTimeout(() => callbackRef.current(childData), 0);
          }, [childData]);
          return null;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("keeps callback-ref calls subject to command filters", () => {
      const result = runRule(
        noPassDataToParent,
        `function PhoneInput({ fetchAllServiceMetrics, childData }) {
          const callbackRef = useRef(fetchAllServiceMetrics);
          useEffect(() => {
            callbackRef.current(childData);
          }, [childData]);
          return null;
        }`,
      );
      const aliasedResult = runRule(
        noPassDataToParent,
        `function PhoneInput(props) {
          const { fetchAllServiceMetrics: notifyParent } = props;
          const callbackAlias = notifyParent;
          const callbackRef = useRef(callbackAlias);
          const childData = buildPhoneData();
          useEffect(() => {
            callbackRef.current(childData);
          }, [childData]);
          return null;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
      expect(aliasedResult.parseErrors).toEqual([]);
      expect(aliasedResult.diagnostics).toEqual([]);
    });

    it("keeps callback-ref calls subject to cleanup and handler-bag filters", () => {
      const cleanupResult = runRule(
        noPassDataToParent,
        `function PhoneInput({ onChange, childData, source }) {
          const callbackRef = useRef(onChange);
          useEffect(() => {
            callbackRef.current(childData);
            return () => source.dispose();
          }, [childData, source]);
          return null;
        }`,
      );
      const handlerBagResult = runRule(
        noPassDataToParent,
        `function PhoneInput({ onReady }) {
          const callbackRef = useRef(onReady);
          const handleChange = () => {};
          useEffect(() => {
            callbackRef.current({ handleChange });
          }, [handleChange]);
          return null;
        }`,
      );
      expect(cleanupResult.parseErrors).toEqual([]);
      expect(cleanupResult.diagnostics).toEqual([]);
      expect(handlerBagResult.parseErrors).toEqual([]);
      expect(handlerBagResult.diagnostics).toEqual([]);
    });
  });
});
