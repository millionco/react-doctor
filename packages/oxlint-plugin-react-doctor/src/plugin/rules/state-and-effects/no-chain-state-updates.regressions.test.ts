import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noChainStateUpdates } from "./no-chain-state-updates.js";

// Must-detect anchors distilled from react-bench-2 planted-bug before-files
// (the 0.5.7 -> 0.5.8 regression review). The traps here are proportionality
// mistakes in the externally-driven-state classification: one setter call
// inside a setTimeout, a plain `{ onX: handler }` options-object property, or
// an async function must NOT mark the whole state externally driven when a
// render-path setter call site also exists.

const expectFiresAtLeast = (code: string, minimumDiagnosticCount: number): void => {
  const result = runRule(noChainStateUpdates, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics.length).toBeGreaterThanOrEqual(minimumDiagnosticCount);
  for (const diagnostic of result.diagnostics) {
    expect(diagnostic.message).toContain("Chaining state updates");
  }
};

describe("no-chain-state-updates — bench must-detect regressions", () => {
  it("fires on validate-then-submit effect chains when one setter call site sits in a setTimeout (latitude Form)", () => {
    expectFiresAtLeast(
      `
      const Form = ({ initialValues, initialErrors, onSubmit }) => {
        const [state, setState] = useState({
          values: initialValues,
          errors: initialErrors ?? {},
          namesToValidate: null,
          submitStatus: 'READY',
        });
        const lastFocusedFieldName = useRef(null);
        const isMountedRef = useRef(true);

        const onBlur = (event) => {
          const parentName = event.target.name;

          setTimeout(() => {
            if (isMountedRef.current && parentName !== lastFocusedFieldName.current) {
              setState((currentState) => setPath(currentState, 'namesToValidate', [parentName]));
            }
          });
        };

        useEffect(() => {
          if (state.namesToValidate === null) {
            return;
          }

          setState((currentState) => {
            let newState = setPath(currentState, 'errors', getNewErrors(currentState));

            if (currentState.submitStatus === 'VALIDATE_THEN_SUBMIT') {
              newState = setPath(newState, 'submitStatus', 'SUBMIT');
            }

            return newState;
          });
        }, [state.namesToValidate]);

        useEffect(() => {
          if (state.submitStatus === 'SUBMIT') {
            onSubmit && onSubmit({ errors: state.errors, values: state.values });

            setState((currentState) => setPath(currentState, 'submitStatus', 'READY'));
          }
        }, [state.submitStatus, state.errors, state.values, onSubmit]);

        return <FormProvider value={state} onBlur={onBlur} />;
      };
      `,
      2,
    );
  });

  it("fires on an editor-creation chain despite on*-named options-object properties (wangeditor EditorComponent)", () => {
    expectFiresAtLeast(
      `
      function EditorComponent(props: Partial<IProps>) {
        const { defaultContent = [], onCreated, value = '', onChange, defaultConfig = {}, mode = 'default' } = props;
        const ref = useRef<HTMLDivElement | null>(null);
        const latestHtmlRef = useRef('');
        const [editor, setEditor] = useState(null);

        const handleCreated = useCallback((createdEditor) => {
          if (onCreated) { onCreated(createdEditor) }
        }, [onCreated]);

        const handleDestroyed = useCallback((destroyedEditor) => {
          const { onDestroyed } = defaultConfig;

          setEditor(null);
          if (onDestroyed) {
            onDestroyed(destroyedEditor);
          }
        }, [defaultConfig]);

        useEffect(() => {
          if (ref.current == null) { return }
          if (editor != null) { return }
          if (ref.current?.getAttribute('data-w-e-textarea')) { return }

          const newEditor = createEditor({
            selector: ref.current,
            config: {
              ...defaultConfig,
              onCreated: handleCreated,
              onDestroyed: handleDestroyed,
            },
            content: defaultContent,
            html: value,
            mode,
          });

          latestHtmlRef.current = newEditor.getHtml();
          setEditor(newEditor);
        }, [editor, defaultConfig, defaultContent, handleCreated, handleDestroyed, mode, value]);

        return <div ref={ref} />;
      }
      `,
      1,
    );
  });

  it("fires when the triggering state's setter also runs in a plain async handler", () => {
    const result = runRule(
      noChainStateUpdates,
      `const Uploader = () => {
        const [file, setFile] = useState(null);
        const [status, setStatus] = useState('idle');

        const handleUpload = async (input) => {
          const uploaded = await upload(input);
          setFile(uploaded);
        };

        useEffect(() => {
          if (file === null) return;
          setStatus('done');
        }, [file]);

        return <input onChange={(event) => handleUpload(event.target)} />;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent when every triggering state dep is set only from a setInterval callback", () => {
    const result = runRule(
      noChainStateUpdates,
      `const Clock = () => {
        const [now, setNow] = useState(Date.now());
        const [late, setLate] = useState(false);
        useEffect(() => {
          const id = setInterval(() => setNow(Date.now()), 1000);
          return () => clearInterval(id);
        }, []);
        useEffect(() => {
          if (now % 2 === 0) setLate(true);
        }, [now]);
        return <div>{now}{late ? '!' : ''}</div>;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
