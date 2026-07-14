import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noResetAllStateOnPropChange } from "./no-reset-all-state-on-prop-change.js";

describe("no-reset-all-state-on-prop-change — regressions", () => {
  // excalidraw ToolPopover: the setter only runs inside an event-subscription
  // callback registered by the effect, so state resets when the emitter
  // fires — not when the `app` prop changes.
  it("stays silent when the setter only runs inside a subscription callback", () => {
    const result = runRule(
      noResetAllStateOnPropChange,
      `import { useEffect, useState } from "react";
      const ToolPopover = ({ app }) => {
        const [isPopupOpen, setIsPopupOpen] = useState(false);
        useEffect(() => {
          const unsubscribe = app.onPointerDownEmitter.on(() => {
            setIsPopupOpen(false);
          });
          return () => unsubscribe?.();
        }, [app]);
        return <div>{String(isPopupOpen)}</div>;
      };`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a synchronous all-state reset keyed on a prop", () => {
    const result = runRule(
      noResetAllStateOnPropChange,
      `import { useEffect, useState } from "react";
      const Profile = ({ userId }) => {
        const [comment, setComment] = useState("");
        useEffect(() => {
          setComment("");
        }, [userId]);
        return <textarea value={comment} onChange={(e) => setComment(e.target.value)} />;
      };`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("clears all state");
  });

  describe("live prop normalizations", () => {
    it("stays silent when a transition tracker records the current Boolean-normalized prop", () => {
      const result = runRule(
        noResetAllStateOnPropChange,
        `import React, { useEffect, useRef, useState } from "react";
        function FocusLock({ disabled, restoreFocus }, ref) {
          const target = useRef(null);
          const [previouslyDisabled, setPreviouslyDisabled] = useState(!!disabled);
          useEffect(() => {
            if (previouslyDisabled !== !!disabled) {
              setPreviouslyDisabled(!!disabled);
              if (restoreFocus && disabled) target.current?.focus();
            }
          }, [previouslyDisabled, disabled, restoreFocus]);
          return <button ref={target} type="button">Target</button>;
        }
        export default React.forwardRef(FocusLock);`,
        { forceJsx: true },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it.each([
      ["double negation", "!!disabled", "!!disabled"],
      ["equivalent Boolean forms", "Boolean(disabled)", "!!disabled"],
      [
        "TypeScript wrappers",
        "(Boolean(disabled) as boolean)",
        "((Boolean(disabled) satisfies boolean)!)",
      ],
      ["whole-props member", "Boolean(props.disabled)", "!!props.disabled"],
    ])("stays silent through %s", (_label, initializer, nextValue) => {
      const result = runRule(
        noResetAllStateOnPropChange,
        `import { useEffect, useState } from "react";
        const Tracker = (props: { disabled?: boolean }) => {
          const { disabled } = props;
          const [previouslyDisabled, setPreviouslyDisabled] = useState(${initializer});
          useEffect(() => {
            setPreviouslyDisabled(${nextValue});
          }, [disabled]);
          return previouslyDisabled;
        };`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("stays silent through an exact immutable normalization alias", () => {
      const result = runRule(
        noResetAllStateOnPropChange,
        `import { useEffect, useState } from "react";
        const Tracker = ({ disabled }: { disabled?: boolean }) => {
          const normalizedDisabled = Boolean(disabled);
          const [previouslyDisabled, setPreviouslyDisabled] = useState(Boolean(disabled));
          useEffect(() => {
            setPreviouslyDisabled(normalizedDisabled as boolean);
          }, [normalizedDisabled]);
          return previouslyDisabled;
        };`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("stays silent through multi-hop immutable normalization aliases", () => {
      const result = runRule(
        noResetAllStateOnPropChange,
        `import { useEffect, useState } from "react";
        const Tracker = ({ disabled }: { disabled?: boolean }) => {
          const directNormalization = Boolean(disabled);
          const normalizedDisabled = directNormalization;
          const [previouslyDisabled, setPreviouslyDisabled] = useState(Boolean(disabled));
          useEffect(() => {
            setPreviouslyDisabled(normalizedDisabled);
          }, [normalizedDisabled]);
          return previouslyDisabled;
        };`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("preserves the existing live-binding exemption for an opaque prop-derived const", () => {
      const result = runRule(
        noResetAllStateOnPropChange,
        `import { useEffect, useState } from "react";
        const Tracker = ({ disabled }: { disabled?: boolean }) => {
          const normalizedDisabled = normalizeDisabled(disabled);
          const [previouslyDisabled, setPreviouslyDisabled] = useState(normalizedDisabled);
          useEffect(() => {
            setPreviouslyDisabled(normalizedDisabled);
          }, [normalizedDisabled]);
          return previouslyDisabled;
        };`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("preserves the existing live-binding exemption for a custom hook result", () => {
      const result = runRule(
        noResetAllStateOnPropChange,
        `import { useEffect, useState } from "react";
        const DropdownOnToggleEffect = ({ onDropdownOpen }) => {
          const isDropdownOpen = useAtomComponentStateValue(isDropdownOpenComponentState);
          const [currentIsDropdownOpen, setCurrentIsDropdownOpen] = useState(isDropdownOpen);
          useEffect(() => {
            if (isDropdownOpen && !currentIsDropdownOpen) {
              setCurrentIsDropdownOpen(isDropdownOpen);
              onDropdownOpen?.();
            }
          }, [currentIsDropdownOpen, isDropdownOpen, onDropdownOpen]);
          return null;
        };`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("stays silent when a transient reset accompanies a live prop mirror", () => {
      const result = runRule(
        noResetAllStateOnPropChange,
        `import { useEffect, useState } from "react";
        const Editor = ({ disabled }: { disabled?: boolean }) => {
          const [previouslyDisabled, setPreviouslyDisabled] = useState(Boolean(disabled));
          const [draft, setDraft] = useState("");
          useEffect(() => {
            setPreviouslyDisabled(Boolean(disabled));
            setDraft("");
          }, [disabled]);
          return <output>{String(previouslyDisabled)}{draft}</output>;
        };`,
        { forceJsx: true },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("does not treat a shadowed useMemo lookalike as a React mount snapshot", () => {
      const result = runRule(
        noResetAllStateOnPropChange,
        `import { useEffect, useState } from "react";
        const Tracker = ({ disabled }: { disabled?: boolean }) => {
          const useMemo = (callback: () => boolean) => callback();
          const normalizedDisabled = useMemo(() => Boolean(disabled));
          const [previouslyDisabled, setPreviouslyDisabled] = useState(normalizedDisabled);
          useEffect(() => {
            setPreviouslyDisabled(normalizedDisabled);
          }, [normalizedDisabled]);
          return previouslyDisabled;
        };`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it.each([
      [
        "mutable alias",
        `let normalizedDisabled = Boolean(disabled);
        const [previouslyDisabled, setPreviouslyDisabled] = useState(normalizedDisabled);
        useEffect(() => {
          normalizedDisabled = Boolean(disabled);
          setPreviouslyDisabled(normalizedDisabled);
        }, [disabled]);`,
      ],
      [
        "constant normalization",
        `const normalizedDisabled = Boolean(false);
        const [previouslyDisabled, setPreviouslyDisabled] = useState(normalizedDisabled);
        useEffect(() => {
          setPreviouslyDisabled(normalizedDisabled);
        }, [disabled]);`,
      ],
      [
        "mount snapshot",
        `const initialDisabledRef = useRef(Boolean(disabled));
        const [previouslyDisabled, setPreviouslyDisabled] = useState(initialDisabledRef.current);
        useEffect(() => {
          setPreviouslyDisabled(initialDisabledRef.current);
        }, [disabled]);`,
      ],
      [
        "aliased mount snapshot",
        `const initialDisabledRef = useRef(Boolean(disabled));
        const initialDisabled = initialDisabledRef.current;
        const [previouslyDisabled, setPreviouslyDisabled] = useState(initialDisabled);
        useEffect(() => {
          setPreviouslyDisabled(initialDisabled);
        }, [disabled]);`,
      ],
      [
        "memoized mount snapshot",
        `const initialDisabled = useMemo(() => Boolean(disabled), []);
        const [previouslyDisabled, setPreviouslyDisabled] = useState(initialDisabled);
        useEffect(() => {
          setPreviouslyDisabled(initialDisabled);
        }, [disabled]);`,
      ],
      [
        "aliased memoized mount snapshot",
        `const initialDisabled = useMemo(() => Boolean(disabled), []);
        const aliasedInitialDisabled = initialDisabled;
        const [previouslyDisabled, setPreviouslyDisabled] = useState(aliasedInitialDisabled);
        useEffect(() => {
          setPreviouslyDisabled(aliasedInitialDisabled);
        }, [disabled]);`,
      ],
      [
        "shadowed Boolean",
        `const Boolean = (value: unknown) => value;
        const [previouslyDisabled, setPreviouslyDisabled] = useState(Boolean(disabled));
        useEffect(() => {
          setPreviouslyDisabled(Boolean(disabled));
        }, [disabled]);`,
      ],
      [
        "module-scoped initial object",
        `const [previouslyDisabled, setPreviouslyDisabled] = useState(INITIAL_STATE);
        useEffect(() => {
          setPreviouslyDisabled(INITIAL_STATE);
        }, [disabled]);`,
      ],
      [
        "module-scoped initial primitive",
        `const [previouslyDisabled, setPreviouslyDisabled] = useState(INITIAL_TAG);
        useEffect(() => {
          setPreviouslyDisabled(INITIAL_TAG);
        }, [disabled]);`,
      ],
    ])("retains the diagnostic for a %s", (_label, componentBody) => {
      const result = runRule(
        noResetAllStateOnPropChange,
        `import { useEffect, useMemo, useRef, useState } from "react";
        const INITIAL_STATE = {};
        const INITIAL_TAG = "all";
        const Tracker = ({ disabled }: { disabled?: boolean }) => {
          ${componentBody}
          return previouslyDisabled;
        };`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });
  });

  describe("delta audit vs 0.7.1", () => {
    it("stays silent on the leading reset of an async resolve effect with cancellation cleanup (freecut inline-source-preview)", () => {
      const result = runRule(
        noResetAllStateOnPropChange,
        `const InlineSourcePreviewContent = memo(function InlineSourcePreviewContent({ mediaId }) {
          const [blobUrl, setBlobUrl] = useState('');
          useEffect(() => {
            let cancelled = false;
            setBlobUrl('');
            resolveMediaUrl(mediaId)
              .then((url) => {
                if (!cancelled) {
                  setBlobUrl(url);
                }
              })
              .catch(() => {});
            return () => {
              cancelled = true;
            };
          }, [mediaId]);
          return null;
        });`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("does not let two call sites of one setter satisfy a two-useState component (freecut inline-composition-preview)", () => {
      const result = runRule(
        noResetAllStateOnPropChange,
        `const InlineCompositionPreviewContent = memo(function InlineCompositionPreviewContent({ compositionId }) {
          const [resolvedTracks, setResolvedTracks] = useState(null);
          const [rendererReady, setRendererReady] = useState(false);
          const compositionInput = useMemo(() => buildInput(compositionId), [compositionId]);
          useEffect(() => {
            if (!compositionInput) {
              setResolvedTracks(null);
              return;
            }
            let cancelled = false;
            setResolvedTracks(null);
            const load = async () => {
              const next = await resolveMediaUrls(compositionInput.tracks);
              if (!cancelled) {
                setResolvedTracks(next);
              }
            };
            void load();
            return () => {
              cancelled = true;
            };
          }, [compositionId, compositionInput]);
          return null;
        });`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("stays silent on a hidden-draft re-sync whose useState was seeded from a live binding (ant-design-mobile picker)", () => {
      const result = runRule(
        noResetAllStateOnPropChange,
        `const Picker = memo(function Picker(props) {
          const { visible } = props;
          const [value, setValue] = usePropsValue(props);
          const [innerValue, setInnerValue] = useState(value);
          useEffect(() => {
            if (!visible) {
              setInnerValue(value);
            }
          }, [value]);
          return null;
        });`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("still flags a reset to a const-literal named constant (upstream 'shared var' parity)", () => {
      const result = runRule(
        noResetAllStateOnPropChange,
        `function ProfilePage({ userId }) {
          const initialState = 'meow meow';
          const [user, setUser] = useState(null);
          const [comment, setComment] = useState(initialState);
          useEffect(() => {
            setUser(null);
            setComment(initialState);
          }, [userId]);
          return null;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("still flags an all-state reset inside a memo(function) component (isProp widening kept)", () => {
      const result = runRule(
        noResetAllStateOnPropChange,
        `const Profile = memo(function Profile({ userId }) {
          const [comment, setComment] = useState("");
          const [draft, setDraft] = useState(null);
          useEffect(() => {
            setComment("");
            setDraft(null);
          }, [userId]);
          return null;
        });`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });
  });

  describe("docs-validation round 2 (shapes covered by the delta-audit fixes)", () => {
    it("stays silent on the semi-controlled visible mirror (coreui CAlert)", () => {
      const result = runRule(
        noResetAllStateOnPropChange,
        `const CAlert = ({ visible }) => {
          const [_visible, setVisible] = useState(visible);
          useEffect(() => {
            setVisible(visible);
          }, [visible]);
          return _visible;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("stays silent when one state re-syncs to a live binding during an imperative teardown (PortOS ScoreSheet)", () => {
      const result = runRule(
        noResetAllStateOnPropChange,
        `function ScoreSheet({ score }) {
          const playerRef = useRef(null);
          const [isPlaying, setIsPlaying] = useState(false);
          const [activeIdx, setActiveIdx] = useState(-1);
          const scoreBpm = Number.isFinite(score.tempo) && score.tempo > 0 ? score.tempo : 90;
          const [tempo, setTempo] = useState(scoreBpm);
          useEffect(() => {
            if (playerRef.current) { playerRef.current.stop(); playerRef.current = null; }
            setIsPlaying(false);
            setActiveIdx(-1);
            setTempo(scoreBpm);
          }, [score, scoreBpm]);
          return tempo;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("stays silent when the sole state syncs an external library instance, not a reset (dtale ColumnAnalysisChart)", () => {
      const result = runRule(
        noResetAllStateOnPropChange,
        `function ColumnAnalysisChart({ fetchedChartData }) {
          const [chart, setChart] = useState();
          const chartRef = useRef(null);
          useEffect(() => {
            setChart(createChart(chartRef.current, fetchedChartData));
          }, [fetchedChartData]);
          return chart ? "y" : "n";
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });
  });
});
