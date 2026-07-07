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
});
