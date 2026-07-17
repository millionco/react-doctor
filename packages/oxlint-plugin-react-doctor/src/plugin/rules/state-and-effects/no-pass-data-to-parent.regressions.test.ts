import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noPassDataToParent } from "./no-pass-data-to-parent.js";

const DEEP_REGISTER_ALIAS_CHAIN_LENGTH = 2_000;

describe("no-pass-data-to-parent — regressions", () => {
  it("stays silent when a callback parameter is passed through a parent callback", () => {
    const result = runRule(
      noPassDataToParent,
      `const useForwarder = (onRegister, callback) => {
  useEffect(() => {
    onRegister(callback);
  }, [onRegister, callback]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

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
    it("stays silent when a ref-held registerPage prop is destructured with an alias (react-pdf Page)", () => {
      const result = runRule(
        noPassDataToParent,
        `import { useDocumentContext } from "./document-context";
        function Page(props) {
          const documentContext = useDocumentContext();
          const mergedProps = { ...documentContext, ...props };
          const { _enableRegisterUnregisterPage = true, pageIndex, registerPage } = mergedProps;
          const pageElement = useRef(null);
          const page = usePage();
          const currentPageIndex = isProvided(pageIndex) ? pageIndex : null;
          const registerPagePropsRef = useRef({
            _enableRegisterUnregisterPage,
            pageIndex: currentPageIndex,
            registerPage,
          });
          useEffect(() => {
            registerPagePropsRef.current = {
              _enableRegisterUnregisterPage,
              pageIndex: currentPageIndex,
              registerPage,
            };
          }, [_enableRegisterUnregisterPage, currentPageIndex, registerPage]);
          useEffect(() => {
            const {
              _enableRegisterUnregisterPage: enableRegisterUnregisterPage,
              pageIndex: currentPageIndex,
              registerPage: currentRegisterPage,
            } = registerPagePropsRef.current;
            if (enableRegisterUnregisterPage && currentRegisterPage && pageElement.current) {
              currentRegisterPage(currentPageIndex, pageElement.current);
            }
          }, [page]);
          return null;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("preserves the direct register command exemption with a default value", () => {
      const result = runRule(
        noPassDataToParent,
        `function Page({ registerPage = () => {} }) {
          const pageData = usePageData();
          useEffect(() => registerPage(pageData), [registerPage, pageData]);
          return null;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("still flags register commands injected through mutated props", () => {
      const reassignedPropsResult = runRule(
        noPassDataToParent,
        `import { useDocumentContext } from "./document-context";
        function Page(props) {
          const documentContext = useDocumentContext();
          props = { ...props, registerPage: props.onData };
          const mergedProps = { ...documentContext, ...props };
          const { registerPage } = mergedProps;
          const callbackBagRef = useRef({ registerPage });
          const { registerPage: notifyParent } = callbackBagRef.current;
          const pageData = buildPageData();
          useEffect(() => notifyParent(pageData), [notifyParent, pageData]);
          return null;
        }`,
      );
      const mutatedPropertyResult = runRule(
        noPassDataToParent,
        `import { useDocumentContext } from "./document-context";
        function Page(props) {
          const documentContext = useDocumentContext();
          props.registerPage = props.onData;
          const mergedProps = { ...documentContext, ...props };
          const { registerPage } = mergedProps;
          const callbackBagRef = useRef({ registerPage });
          const { registerPage: notifyParent } = callbackBagRef.current;
          const pageData = buildPageData();
          useEffect(() => notifyParent(pageData), [notifyParent, pageData]);
          return null;
        }`,
      );
      expect(reassignedPropsResult.parseErrors).toEqual([]);
      expect(reassignedPropsResult.diagnostics).toHaveLength(1);
      expect(mutatedPropertyResult.parseErrors).toEqual([]);
      expect(mutatedPropertyResult.diagnostics).toHaveLength(1);
    });

    it("still flags a register command from an escaped context object", () => {
      const result = runRule(
        noPassDataToParent,
        `import { useDocumentContext } from "./document-context";
        function Page(props) {
          const documentContext = useDocumentContext();
          mutate(documentContext);
          const mergedProps = { ...documentContext, ...props };
          const { registerPage } = mergedProps;
          const callbackBagRef = useRef({ registerPage });
          const { registerPage: notifyParent } = callbackBagRef.current;
          const pageData = buildPageData();
          useEffect(() => notifyParent(pageData), [notifyParent, pageData]);
          return null;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("still flags reverse-order and shadowed context merges", () => {
      const reverseOrderResult = runRule(
        noPassDataToParent,
        `import { useDocumentContext } from "./document-context";
        function Page(props) {
          const documentContext = useDocumentContext();
          const mergedProps = { ...props, ...documentContext };
          const { registerPage } = mergedProps;
          const callbackBagRef = useRef({ registerPage });
          const { registerPage: notifyParent } = callbackBagRef.current;
          const pageData = buildPageData();
          useEffect(() => notifyParent(pageData), [notifyParent, pageData]);
          return null;
        }`,
      );
      const shadowedContextResult = runRule(
        noPassDataToParent,
        `function Page(props) {
          const useDocumentContext = () => ({ registerPage: props.onData });
          const documentContext = useDocumentContext();
          const mergedProps = { ...documentContext, ...props };
          const { registerPage } = mergedProps;
          const callbackBagRef = useRef({ registerPage });
          const { registerPage: notifyParent } = callbackBagRef.current;
          const pageData = buildPageData();
          useEffect(() => notifyParent(pageData), [notifyParent, pageData]);
          return null;
        }`,
      );
      expect(reverseOrderResult.parseErrors).toEqual([]);
      expect(reverseOrderResult.diagnostics).toHaveLength(1);
      expect(shadowedContextResult.parseErrors).toEqual([]);
      expect(shadowedContextResult.diagnostics).toHaveLength(1);
    });

    it("preserves register command names through direct destructuring and immutable aliases", () => {
      const result = runRule(
        noPassDataToParent,
        `function Page(props) {
          const { registerPage: currentRegisterPage } = props;
          const registerCurrentPage = currentRegisterPage;
          const command = registerCurrentPage;
          const pageData = buildPageData();
          useEffect(() => {
            command(pageData);
          }, [command, pageData]);
          return null;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("preserves register command names through ref aliases and static property reads", () => {
      const result = runRule(
        noPassDataToParent,
        `function Page({ registerPage, pageIndex }) {
          const registerPagePropsRef = React.useRef({ registerPage });
          const registerPagePropsRefAlias = registerPagePropsRef;
          registerPagePropsRefAlias.current = { registerPage };
          const currentRegisterPage = registerPagePropsRefAlias["current"]["registerPage"];
          const registerCurrentPage = currentRegisterPage;
          const pageData = buildPageData(pageIndex);
          useEffect(() => {
            registerCurrentPage(pageData);
          }, [pageData]);
          return null;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("still flags an ordinary callback stored under a register-named object property", () => {
      const localObjectResult = runRule(
        noPassDataToParent,
        `function Page({ onData }) {
          const callbackBag = { registerPage: onData };
          const { registerPage: notifyParent } = callbackBag;
          const pageData = buildPageData();
          useEffect(() => {
            notifyParent(pageData);
          }, [notifyParent, pageData]);
          return null;
        }`,
      );
      const refObjectResult = runRule(
        noPassDataToParent,
        `function Page({ onData }) {
          const callbackBagRef = useRef({ registerPage: onData });
          const { registerPage: notifyParent } = callbackBagRef.current;
          const pageData = buildPageData();
          useEffect(() => {
            notifyParent(pageData);
          }, [notifyParent, pageData]);
          return null;
        }`,
      );
      expect(localObjectResult.parseErrors).toEqual([]);
      expect(localObjectResult.diagnostics).toHaveLength(1);
      expect(refObjectResult.parseErrors).toEqual([]);
      expect(refObjectResult.diagnostics).toHaveLength(1);
    });

    it("still flags ref-held register properties with competing or opaque assignments", () => {
      const competingAssignmentResult = runRule(
        noPassDataToParent,
        `function Page({ registerPage, onData, disabled }) {
          const callbackBagRef = useRef({ registerPage });
          if (disabled) callbackBagRef.current = { registerPage: onData };
          const { registerPage: notifyParent } = callbackBagRef.current;
          const pageData = buildPageData();
          useEffect(() => {
            notifyParent(pageData);
          }, [notifyParent, pageData]);
          return null;
        }`,
      );
      const opaqueAssignmentResult = runRule(
        noPassDataToParent,
        `function Page({ registerPage, nextCallbacks }) {
          const callbackBagRef = useRef({ registerPage });
          callbackBagRef.current = nextCallbacks;
          const { registerPage: notifyParent } = callbackBagRef.current;
          const pageData = buildPageData();
          useEffect(() => {
            notifyParent(pageData);
          }, [notifyParent, pageData]);
          return null;
        }`,
      );
      expect(competingAssignmentResult.parseErrors).toEqual([]);
      expect(competingAssignmentResult.diagnostics).toHaveLength(1);
      expect(opaqueAssignmentResult.parseErrors).toEqual([]);
      expect(opaqueAssignmentResult.diagnostics).toHaveLength(1);
    });

    it("still flags computed properties that can override register commands", () => {
      const initializerResult = runRule(
        noPassDataToParent,
        `function Page({ registerPage, onData, commandName }) {
          const callbackBagRef = useRef({ registerPage, [commandName]: onData });
          const { registerPage: notifyParent } = callbackBagRef.current;
          const pageData = buildPageData();
          useEffect(() => notifyParent(pageData), [notifyParent, pageData]);
          return null;
        }`,
      );
      const assignmentResult = runRule(
        noPassDataToParent,
        `function Page({ registerPage, onData, commandName }) {
          const callbackBagRef = useRef({ registerPage });
          callbackBagRef.current = { registerPage, [commandName]: onData };
          const { registerPage: notifyParent } = callbackBagRef.current;
          const pageData = buildPageData();
          useEffect(() => notifyParent(pageData), [notifyParent, pageData]);
          return null;
        }`,
      );
      expect(initializerResult.parseErrors).toEqual([]);
      expect(initializerResult.diagnostics).toHaveLength(1);
      expect(assignmentResult.parseErrors).toEqual([]);
      expect(assignmentResult.diagnostics).toHaveLength(1);
    });

    it("still flags mutable, dynamically keyed, and shadowed ref variants", () => {
      const mutableResult = runRule(
        noPassDataToParent,
        `function Page({ registerPage, onData }) {
          const callbackBagRef = useRef({ registerPage });
          let { registerPage: notifyParent } = callbackBagRef.current;
          notifyParent = onData;
          const pageData = buildPageData();
          useEffect(() => {
            notifyParent(pageData);
          }, [notifyParent, pageData]);
          return null;
        }`,
      );
      const dynamicResult = runRule(
        noPassDataToParent,
        `function Page({ registerPage, commandName }) {
          const callbackBagRef = useRef({ registerPage });
          const { [commandName]: notifyParent } = callbackBagRef.current;
          const pageData = buildPageData();
          useEffect(() => {
            notifyParent(pageData);
          }, [notifyParent, pageData]);
          return null;
        }`,
      );
      const shadowedResult = runRule(
        noPassDataToParent,
        `function Page({ registerPage }) {
          const useRef = (value) => ({ current: value });
          const callbackBagRef = useRef({ registerPage });
          const { registerPage: notifyParent } = callbackBagRef.current;
          const pageData = buildPageData();
          useEffect(() => {
            notifyParent(pageData);
          }, [notifyParent, pageData]);
          return null;
        }`,
      );
      expect(mutableResult.parseErrors).toEqual([]);
      expect(mutableResult.diagnostics).toHaveLength(1);
      expect(dynamicResult.parseErrors).toEqual([]);
      expect(dynamicResult.diagnostics).toHaveLength(1);
      expect(shadowedResult.parseErrors).toEqual([]);
      expect(shadowedResult.diagnostics).toHaveLength(1);
    });

    it("still flags target property writes and opaque ref-object escape", () => {
      const propertyWriteResult = runRule(
        noPassDataToParent,
        `function Page({ registerPage, onData }) {
          const callbackBagRef = useRef({ registerPage });
          callbackBagRef.current.registerPage = onData;
          const { registerPage: notifyParent } = callbackBagRef.current;
          const pageData = buildPageData();
          useEffect(() => {
            notifyParent(pageData);
          }, [notifyParent, pageData]);
          return null;
        }`,
      );
      const escapedRefResult = runRule(
        noPassDataToParent,
        `function Page({ registerPage }) {
          const callbackBagRef = useRef({ registerPage });
          synchronizeCallbacks(callbackBagRef);
          const { registerPage: notifyParent } = callbackBagRef.current;
          const pageData = buildPageData();
          useEffect(() => {
            notifyParent(pageData);
          }, [notifyParent, pageData]);
          return null;
        }`,
      );
      expect(propertyWriteResult.parseErrors).toEqual([]);
      expect(propertyWriteResult.diagnostics).toHaveLength(1);
      expect(escapedRefResult.parseErrors).toEqual([]);
      expect(escapedRefResult.diagnostics).toHaveLength(1);
    });

    it("still flags mutable and reassigned callback sources stored under registerPage", () => {
      const mutableAliasResult = runRule(
        noPassDataToParent,
        `function Page({ onData }) {
          let registerPage = onData;
          const callbackBagRef = useRef({ registerPage });
          const { registerPage: notifyParent } = callbackBagRef.current;
          const pageData = buildPageData();
          useEffect(() => notifyParent(pageData), [notifyParent, pageData]);
          return null;
        }`,
      );
      const reassignedPropResult = runRule(
        noPassDataToParent,
        `function Page({ registerPage, onData }) {
          registerPage = onData;
          const callbackBagRef = useRef({ registerPage });
          const { registerPage: notifyParent } = callbackBagRef.current;
          const pageData = buildPageData();
          useEffect(() => notifyParent(pageData), [notifyParent, pageData]);
          return null;
        }`,
      );
      expect(mutableAliasResult.parseErrors).toEqual([]);
      expect(mutableAliasResult.diagnostics).toHaveLength(1);
      expect(reassignedPropResult.parseErrors).toEqual([]);
      expect(reassignedPropResult.diagnostics).toHaveLength(1);
    });

    it("still flags a mutated props member stored under registerPage", () => {
      const result = runRule(
        noPassDataToParent,
        `function Page(props) {
          props.registerPage = props.onData;
          const callbackBagRef = useRef({ registerPage: props.registerPage });
          const { registerPage: notifyParent } = callbackBagRef.current;
          const pageData = buildPageData();
          useEffect(() => notifyParent(pageData), [notifyParent, pageData]);
          return null;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("still flags local-bag and fallback laundering", () => {
      const localBagResult = runRule(
        noPassDataToParent,
        `function Page({ registerPage, onData }) {
          const localBag = { registerPage: onData };
          const { registerPage: fakeRegisterPage } = localBag;
          const callbackBagRef = useRef({ registerPage: fakeRegisterPage });
          const { registerPage: notifyParent } = callbackBagRef.current;
          const pageData = buildPageData();
          useEffect(() => notifyParent(pageData), [notifyParent, pageData]);
          return null;
        }`,
      );
      const fallbackResult = runRule(
        noPassDataToParent,
        `function Page({ registerPage, onData }) {
          const callbackBagRef = useRef({ registerPage });
          const { registerPage: notifyParent = onData } = callbackBagRef.current;
          const pageData = buildPageData();
          useEffect(() => notifyParent(pageData), [notifyParent, pageData]);
          return null;
        }`,
      );
      expect(localBagResult.parseErrors).toEqual([]);
      expect(localBagResult.diagnostics).toHaveLength(1);
      expect(fallbackResult.parseErrors).toEqual([]);
      expect(fallbackResult.diagnostics).toHaveLength(1);
    });

    it("still flags pattern and loop writes to a ref-held registerPage property", () => {
      const patterns = [
        `({ registerPage: callbackBagRef.current.registerPage } = { registerPage: onData });`,
        `[callbackBagRef.current.registerPage] = [onData];`,
        `for (callbackBagRef.current.registerPage of [onData]) break;`,
      ];
      for (const pattern of patterns) {
        const result = runRule(
          noPassDataToParent,
          `function Page({ registerPage, onData }) {
            const callbackBagRef = useRef({ registerPage });
            ${pattern}
            const { registerPage: notifyParent } = callbackBagRef.current;
            const pageData = buildPageData();
            useEffect(() => notifyParent(pageData), [notifyParent, pageData]);
            return null;
          }`,
        );
        expect(result.parseErrors).toEqual([]);
        expect(result.diagnostics).toHaveLength(1);
      }
    });

    it("preserves callback-ref diagnostics for defaulted and later-reassigned props", () => {
      const defaultedPropResult = runRule(
        noPassDataToParent,
        `function Page({ onData = () => {} }) {
          const callbackRef = useRef(onData);
          const pageData = buildPageData();
          useEffect(() => callbackRef.current(pageData), [pageData]);
          return null;
        }`,
      );
      const reassignedPropResult = runRule(
        noPassDataToParent,
        `function Page({ onData }) {
          const callbackRef = useRef(onData);
          onData = (pageData) => log(pageData);
          const pageData = buildPageData();
          useEffect(() => callbackRef.current(pageData), [pageData]);
          return null;
        }`,
      );
      expect(defaultedPropResult.parseErrors).toEqual([]);
      expect(defaultedPropResult.diagnostics).toHaveLength(1);
      expect(reassignedPropResult.parseErrors).toEqual([]);
      expect(reassignedPropResult.diagnostics).toHaveLength(1);
    });

    it("does not overflow on a deep immutable callback alias chain", () => {
      const aliasDeclarations = Array.from(
        { length: DEEP_REGISTER_ALIAS_CHAIN_LENGTH },
        (_, aliasIndex) => `const registerAlias${aliasIndex + 1} = registerAlias${aliasIndex};`,
      ).join("\n");
      const result = runRule(
        noPassDataToParent,
        `function Page({ registerPage }) {
          const callbackBagRef = useRef({ registerPage });
          const { registerPage: registerAlias0 } = callbackBagRef.current;
          ${aliasDeclarations}
          const pageData = buildPageData();
          useEffect(() => {
            registerAlias${DEEP_REGISTER_ALIAS_CHAIN_LENGTH}(pageData);
          }, [pageData]);
          return null;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

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
    it("flags the React PhoneNr Input callback ref refreshed by a preceding effect", () => {
      const result = runRule(
        noPassDataToParent,
        `function PhoneInput({ onChange, withCountryMeta }) {
          const { country, phoneNumber } = usePhonenumber();
          const onChangeRef = useRef(onChange);
          useEffect(() => {
            onChangeRef.current = onChange;
          }, [onChange]);
          useEffect(() => {
            const data = withCountryMeta
              ? { phoneNumber, country }
              : phoneNumber;
            onChangeRef.current(data);
          }, [country, phoneNumber, withCountryMeta]);
          return null;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("flags a React namespace callback ref with the same ordered refresh", () => {
      const result = runRule(
        noPassDataToParent,
        `import * as React from "react";
        function PhoneInput({ onChange }) {
          const childData = usePhoneData();
          const onChangeRef = React.useRef(onChange);
          React.useEffect(() => {
            onChangeRef.current = onChange;
          }, [onChange]);
          React.useEffect(() => {
            onChangeRef.current(childData);
          }, [childData]);
          return null;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("stays silent when an effect refresh does not prove the same parent callback", () => {
      const validSources = [
        `function PhoneInput({ onChange, onCommit }) {
          const childData = usePhoneData();
          const callbackRef = useRef(onChange);
          useEffect(() => { callbackRef.current = onCommit; }, [onCommit]);
          useEffect(() => { callbackRef.current(childData); }, [childData]);
          return null;
        }`,
        `function PhoneInput({ onChange }) {
          const childData = usePhoneData();
          const callbackRef = useRef(null);
          useEffect(() => { callbackRef.current = onChange; }, [onChange]);
          useEffect(() => { callbackRef.current(childData); }, [childData]);
          return null;
        }`,
        `function PhoneInput({ onChange, disabled }) {
          const childData = usePhoneData();
          const callbackRef = useRef(onChange);
          useEffect(() => {
            if (!disabled) callbackRef.current = onChange;
          }, [disabled, onChange]);
          useEffect(() => { callbackRef.current(childData); }, [childData]);
          return null;
        }`,
        `function PhoneInput({ onChange }) {
          const childData = usePhoneData();
          const callbackRef = useRef(onChange);
          useEffect(() => {
            const refresh = () => { callbackRef.current = onChange; };
            refresh();
          }, [onChange]);
          useEffect(() => { callbackRef.current(childData); }, [childData]);
          return null;
        }`,
        `function PhoneInput({ onChange }) {
          const childData = usePhoneData();
          const callbackRef = useRef(onChange);
          useEffect(() => {
            queueMicrotask(() => { callbackRef.current = onChange; });
          }, [onChange]);
          useEffect(() => { callbackRef.current(childData); }, [childData]);
          return null;
        }`,
        `function PhoneInput({ onChange }) {
          const useEffect = (callback) => callback();
          const childData = usePhoneData();
          const callbackRef = useRef(onChange);
          useEffect(() => { callbackRef.current = onChange; }, [onChange]);
          useEffect(() => { callbackRef.current(childData); }, [childData]);
          return null;
        }`,
        `function PhoneInput({ onChange }) {
          const childData = usePhoneData();
          const callbackRef = useRef(onChange);
          useLayoutEffect(() => { callbackRef.current = onChange; }, [onChange]);
          useEffect(() => { callbackRef.current(childData); }, [childData]);
          return null;
        }`,
        `function PhoneInput({ onChange }) {
          const childData = usePhoneData();
          const callbackRef = useRef(onChange);
          useEffect(() => { callbackRef.current(childData); }, [childData]);
          useEffect(() => { callbackRef.current = onChange; }, [onChange]);
          return null;
        }`,
        `function PhoneInput({ onChange }) {
          const childData = usePhoneData();
          const callbackRef = useRef(onChange);
          useEffect(() => { refreshCallbackRef(callbackRef, onChange); }, [onChange]);
          useEffect(() => { callbackRef.current(childData); }, [childData]);
          return null;
        }`,
        `function PhoneInput({ onChange }) {
          const childData = usePhoneData();
          const callbackRef = useRef(onChange);
          useEffect(() => { callbackRef.current += onChange; }, [onChange]);
          useEffect(() => { callbackRef.current(childData); }, [childData]);
          return null;
        }`,
        `function PhoneInput({ onChange }) {
          const useRef = (value) => ({ current: value });
          const childData = usePhoneData();
          const callbackRef = useRef(onChange);
          useEffect(() => { callbackRef.current = onChange; }, [onChange]);
          useEffect(() => { callbackRef.current(childData); }, [childData]);
          return null;
        }`,
        `function PhoneInput({ onChange }) {
          const localCallback = (value) => log(value);
          const childData = usePhoneData();
          const callbackRef = useRef(onChange);
          useEffect(() => { callbackRef.current = onChange; }, [onChange]);
          callbackRef.current = localCallback;
          useEffect(() => { callbackRef.current(childData); }, [childData]);
          return null;
        }`,
        `function PhoneInput({ onChange }) {
          const childData = usePhoneData();
          const callbackRef = useCallbackRef(onChange);
          useEffect(() => { callbackRef.current = onChange; }, [onChange]);
          useEffect(() => { callbackRef.current(childData); }, [childData]);
          return null;
        }`,
      ];
      for (const validSource of validSources) {
        const result = runRule(noPassDataToParent, validSource);
        expect(result.parseErrors).toEqual([]);
        expect(result.diagnostics).toEqual([]);
      }
    });

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

    it("preserves a parent callback passed directly to React useEffectEvent", () => {
      const result = runRule(
        noPassDataToParent,
        `import { useEffect, useEffectEvent } from "react";
        function PhoneInput({ onChange, withCountryMeta }) {
          const notify = useEffectEvent(onChange);
          useEffect(() => {
            const data = buildPhoneData(withCountryMeta);
            notify(data);
          }, [withCountryMeta]);
          return null;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("preserves a parent member callback passed directly to React.useEffectEvent", () => {
      const result = runRule(
        noPassDataToParent,
        `import * as React from "react";
        function PhoneInput(props) {
          const notify = React.useEffectEvent(props.onChange);
          React.useEffect(() => {
            notify(buildValue());
          }, [buildValue]);
          return null;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("preserves a parent callback passed directly to React useCallback", () => {
      const result = runRule(
        noPassDataToParent,
        `import { useCallback, useEffect } from "react";
        function PhoneInput({ onChange }) {
          const notify = useCallback(onChange, [onChange]);
          useEffect(() => {
            notify(buildPhoneData());
          }, [notify]);
          return null;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("does not trust userland or imported useEffectEvent lookalikes", () => {
      const localResult = runRule(
        noPassDataToParent,
        `function useEffectEvent(callback) {
          return callback;
        }
        function PhoneInput({ onChange, phoneNumber }) {
          const notify = useEffectEvent(onChange);
          useEffect(() => notify(phoneNumber), [notify, phoneNumber]);
          return null;
        }`,
      );
      const importedResult = runRule(
        noPassDataToParent,
        `import { useEffectEvent } from "effect-event-polyfill";
        function PhoneInput({ onChange, phoneNumber }) {
          const notify = useEffectEvent(onChange);
          useEffect(() => notify(phoneNumber), [notify, phoneNumber]);
          return null;
        }`,
      );
      expect(localResult.parseErrors).toEqual([]);
      expect(importedResult.parseErrors).toEqual([]);
      expect(localResult.diagnostics).toEqual([]);
      expect(importedResult.diagnostics).toEqual([]);
    });

    it("does not preserve direct wrapper provenance through a mutable callback alias", () => {
      const result = runRule(
        noPassDataToParent,
        `import { useEffect, useEffectEvent } from "react";
        function PhoneInput({ onChange, phoneNumber }) {
          let callback = onChange;
          callback = log;
          const notify = useEffectEvent(callback);
          useEffect(() => notify(phoneNumber), [notify, phoneNumber]);
          return null;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
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
