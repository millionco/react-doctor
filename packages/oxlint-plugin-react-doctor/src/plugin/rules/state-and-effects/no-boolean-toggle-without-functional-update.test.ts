import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noBooleanToggleWithoutFunctionalUpdate } from "./no-boolean-toggle-without-functional-update.js";

describe("no-boolean-toggle-without-functional-update", () => {
  it("flags setIsOpen(!isOpen) inside a setTimeout", () => {
    const result = runRule(
      noBooleanToggleWithoutFunctionalUpdate,
      `
      const C = () => {
        const [isOpen, setIsOpen] = useState(false);
        useEffect(() => {
          setTimeout(() => setIsOpen(!isOpen), 100);
        }, []);
      };
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a toggle inside a subscription callback", () => {
    const result = runRule(
      noBooleanToggleWithoutFunctionalUpdate,
      `
      const C = () => {
        const [collapsed, setCollapsed] = useState(false);
        useEffect(() => {
          const sub = source.subscribe(() => setCollapsed(!collapsed));
          return () => sub.unsubscribe();
        }, []);
      };
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a toggle inside a promise .then handler", () => {
    const result = runRule(
      noBooleanToggleWithoutFunctionalUpdate,
      `
      const C = () => {
        const [allowChatSupport, setAllowChatSupport] = useState(false);
        const onLoad = () => {
          load().then(() => setAllowChatSupport(!allowChatSupport));
        };
      };
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a synchronous onClick toggle", () => {
    const result = runRule(
      noBooleanToggleWithoutFunctionalUpdate,
      `
      const CollapsingSection = () => {
        const [isOpen, setIsOpen] = useState(false);
        return <button onClick={() => setIsOpen(!isOpen)} />;
      };
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag negating a different variable", () => {
    const result = runRule(
      noBooleanToggleWithoutFunctionalUpdate,
      `
      const C = ({ open }) => {
        const [sideMenuOpen, setSideMenuOpen] = useState(false);
        useEffect(() => {
          setTimeout(() => setSideMenuOpen(!open), 100);
        }, [open]);
      };
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a MemberExpression argument", () => {
    const result = runRule(
      noBooleanToggleWithoutFunctionalUpdate,
      `
      const C = ({ field }) => {
        const [value, setValue] = useState(false);
        useEffect(() => {
          setTimeout(() => setValue(!field.value), 100);
        }, []);
      };
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag the correct functional updater form", () => {
    const result = runRule(
      noBooleanToggleWithoutFunctionalUpdate,
      `
      const C = () => {
        const [isOpen, setIsOpen] = useState(false);
        useEffect(() => {
          setTimeout(() => setIsOpen((prev) => !prev), 100);
        }, []);
      };
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when the setter has no matching useState pair", () => {
    const result = runRule(
      noBooleanToggleWithoutFunctionalUpdate,
      `
      const C = ({ open }) => {
        const setOpen = useStore((s) => s.setOpen);
        useEffect(() => {
          setTimeout(() => setOpen(!open), 100);
        }, []);
      };
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a numeric negation (arithmetic rule's domain)", () => {
    const result = runRule(
      noBooleanToggleWithoutFunctionalUpdate,
      `
      const C = () => {
        const [count, setCount] = useState(0);
        useEffect(() => {
          setTimeout(() => setCount(-count), 100);
        }, []);
      };
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags setOpen(!isOpen) when the useState pair is [isOpen, setOpen]", () => {
    const result = runRule(
      noBooleanToggleWithoutFunctionalUpdate,
      `
      const C = () => {
        const [isOpen, setOpen] = useState(false);
        useEffect(() => {
          setTimeout(() => setOpen(!isOpen), 100);
        }, []);
      };
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  // Real-world idiom: a DOM event handler negating the FRESH value it just
  // read from the event, stored in a local that shadows the state name.
  it("does not flag when the operand is a shadowing local reading the fresh event value", () => {
    const result = runRule(
      noBooleanToggleWithoutFunctionalUpdate,
      `
      const C = () => {
        const [checked, setChecked] = useState(false);
        useEffect(() => {
          el.addEventListener("change", (event) => {
            const checked = event.target.checked;
            setChecked(!checked);
          });
        }, []);
      };
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  // Real-world idiom: a subscription callback whose parameter delivers the
  // fresh value and shadows the state name.
  it("does not flag a callback parameter shadowing the state name", () => {
    const result = runRule(
      noBooleanToggleWithoutFunctionalUpdate,
      `
      const C = () => {
        const [muted, setMuted] = useState(false);
        useEffect(() => {
          const sub = source.subscribe((muted) => setMuted(!muted));
          return () => sub.unsubscribe();
        }, []);
      };
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  // Real-world idiom: an effect closure runs from the committing render with
  // fresh state, so a direct effect-body toggle never reads a stale value.
  it("does not flag a direct effect-body toggle with the state in deps", () => {
    const result = runRule(
      noBooleanToggleWithoutFunctionalUpdate,
      `
      const C = ({ trigger }) => {
        const [flipped, setFlipped] = useState(false);
        useEffect(() => {
          if (trigger && flipped) setFlipped(!flipped);
        }, [trigger, flipped]);
      };
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  // Real-world idiom: Storybook demo files toggle state loosely on purpose.
  it("does not flag inside a Storybook stories file", () => {
    const result = runRule(
      noBooleanToggleWithoutFunctionalUpdate,
      `
      const Demo = () => {
        const [isOpen, setIsOpen] = useState(false);
        useEffect(() => {
          setTimeout(() => setIsOpen(!isOpen), 100);
        }, []);
      };
      `,
      { filename: "toggle.stories.tsx" },
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a useReducer dispatch toggle", () => {
    const result = runRule(
      noBooleanToggleWithoutFunctionalUpdate,
      `
      const C = () => {
        const [open, setOpen] = useReducer((s) => !s, false);
        useEffect(() => {
          setTimeout(() => setOpen(!open), 100);
        }, []);
      };
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Inline keydown listener with AbortController cleanup and state in deps (re-subscribed on every toggle)", () => {
    const result = runRule(
      noBooleanToggleWithoutFunctionalUpdate,
      `const VideoPlayer = () => {
  const [isPlaying, setIsPlaying] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    document.addEventListener(
      "keydown",
      (event) => {
        if (event.code === "Space") setIsPlaying(!isPlaying);
      },
      { signal: controller.signal },
    );
    return () => controller.abort();
  }, [isPlaying]);
  return <video muted={!isPlaying} />;
};`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Blinking-cursor setInterval with clearInterval cleanup and state in deps", () => {
    const result = runRule(
      noBooleanToggleWithoutFunctionalUpdate,
      `const Cursor = () => {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const intervalId = setInterval(() => setVisible(!visible), 500);
    return () => clearInterval(intervalId);
  }, [visible]);
  return <span style={{ opacity: visible ? 1 : 0 }}>|</span>;
};`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for a cleaned-up window timer with state in deps", () => {
    const result = runRule(
      noBooleanToggleWithoutFunctionalUpdate,
      `const Cursor = () => {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const intervalId = window.setInterval(() => setVisible(!visible), 500);
    return () => window.clearInterval(intervalId);
  }, [visible]);
  return <span style={{ opacity: visible ? 1 : 0 }}>|</span>;
};`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Write-through mirror of an absolute external command in .then — the rule's own remediation would introduce a desync bug", () => {
    const result = runRule(
      noBooleanToggleWithoutFunctionalUpdate,
      `const MuteButton = ({ player }) => {
  const [muted, setMuted] = useState(false);
  const handleToggleMute = () => {
    player.setMuted(!muted).then(() => setMuted(!muted));
  };
  return <button onClick={handleToggleMute}>{muted ? "Unmute" : "Mute"}</button>;
};`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts aliased write-through mirrors of absolute promise commands", () => {
    const constAlias = runRule(
      noBooleanToggleWithoutFunctionalUpdate,
      "const C=({player})=>{const[muted,setMuted]=useState(false);const mirror=()=>setMuted(!muted);player.setMuted(!muted).then(mirror)}",
    );
    const declarationAlias = runRule(
      noBooleanToggleWithoutFunctionalUpdate,
      "const C=({player})=>{const[muted,setMuted]=useState(false);function mirror(){setMuted(!muted)}player.setMuted(!muted).then(mirror)}",
    );
    expect(constAlias.diagnostics).toHaveLength(0);
    expect(declarationAlias.diagnostics).toHaveLength(0);
  });

  it("rejects aliased promise mirrors without exclusively qualifying registrations", () => {
    const reusedForLoad = runRule(
      noBooleanToggleWithoutFunctionalUpdate,
      "const C=({player})=>{const[muted,setMuted]=useState(false);const mirror=()=>setMuted(!muted);player.setMuted(!muted).then(mirror);load().then(mirror)}",
    );
    const reusedForTimer = runRule(
      noBooleanToggleWithoutFunctionalUpdate,
      "const C=({player})=>{const[muted,setMuted]=useState(false);const mirror=()=>setMuted(!muted);player.setMuted(!muted).then(mirror);setTimeout(mirror,0)}",
    );
    const reassignedAlias = runRule(
      noBooleanToggleWithoutFunctionalUpdate,
      "const C=({player})=>{const[muted,setMuted]=useState(false);const mirror=()=>setMuted(!muted);let callback=mirror;player.setMuted(!muted).then(callback);callback=()=>{};setTimeout(mirror,0)}",
    );
    const unregisteredAlias = runRule(
      noBooleanToggleWithoutFunctionalUpdate,
      "const C=({player})=>{const[muted,setMuted]=useState(false);const mirror=()=>setMuted(!muted);player.setMuted(!muted).then(()=>{});setTimeout(mirror,0)}",
    );
    const wrongPromiseMethod = runRule(
      noBooleanToggleWithoutFunctionalUpdate,
      "const C=({player})=>{const[muted,setMuted]=useState(false);const mirror=()=>setMuted(!muted);player.setMuted(!muted).catch(mirror)}",
    );
    expect(reusedForLoad.diagnostics).toHaveLength(1);
    expect(reusedForTimer.diagnostics).toHaveLength(1);
    expect(reassignedAlias.diagnostics).toHaveLength(1);
    expect(unregisteredAlias.diagnostics).toHaveLength(1);
    expect(wrongPromiseMethod.diagnostics).toHaveLength(1);
  });

  it("stays quiet: Latest-ref equality guard proving the captured value is still current before toggling", () => {
    const result = runRule(
      noBooleanToggleWithoutFunctionalUpdate,
      `const DelayedToggle = ({ trigger }) => {
  const [open, setOpen] = useState(false);
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    if (!trigger) return;
    const timerId = setTimeout(() => {
      if (openRef.current === open) setOpen(!open);
    }, 200);
    return () => clearTimeout(timerId);
  }, [trigger, open]);
  return <div data-open={open} />;
};`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts latest-ref guards after unconditional state mirror writes", () => {
    const booleanInitializer = runRule(
      noBooleanToggleWithoutFunctionalUpdate,
      "const C=()=>{const[open,setOpen]=useState(false);const ref=useRef(false);ref.current=open;setTimeout(()=>{if(ref.current===open)setOpen(!open)},1)}",
    );
    const numericInitializer = runRule(
      noBooleanToggleWithoutFunctionalUpdate,
      "const C=()=>{const[open,setOpen]=useState(false);const ref=useRef(0);ref.current=open;setTimeout(()=>{if(ref.current===open)setOpen(!open)},1)}",
    );
    expect(booleanInitializer.diagnostics).toHaveLength(0);
    expect(numericInitializer.diagnostics).toHaveLength(0);
  });

  it("rejects latest-ref guards without a stable unconditional mirror write", () => {
    const conditionalWrite = runRule(
      noBooleanToggleWithoutFunctionalUpdate,
      "const C=({ready})=>{const[open,setOpen]=useState(false);const ref=useRef(false);if(ready)ref.current=open;setTimeout(()=>{if(ref.current===open)setOpen(!open)},1)}",
    );
    const writeAfterUse = runRule(
      noBooleanToggleWithoutFunctionalUpdate,
      "const C=()=>{const[open,setOpen]=useState(false);const ref=useRef(false);setTimeout(()=>{if(ref.current===open)setOpen(!open);ref.current=open},1)}",
    );
    const wrongState = runRule(
      noBooleanToggleWithoutFunctionalUpdate,
      "const C=()=>{const[open,setOpen]=useState(false);const[ready]=useState(false);const ref=useRef(false);ref.current=ready;setTimeout(()=>{if(ref.current===open)setOpen(!open)},1)}",
    );
    const reassignedRef = runRule(
      noBooleanToggleWithoutFunctionalUpdate,
      "const C=()=>{const[open,setOpen]=useState(false);let ref=useRef(false);ref.current=open;ref={current:open};setTimeout(()=>{if(ref.current===open)setOpen(!open)},1)}",
    );
    expect(conditionalWrite.diagnostics).toHaveLength(1);
    expect(writeAfterUse.diagnostics).toHaveLength(1);
    expect(wrongState.diagnostics).toHaveLength(1);
    expect(reassignedRef.diagnostics).toHaveLength(1);
  });

  it("still flags a toggle in a deferred callback of a mount-only effect", () => {
    const result = runRule(
      noBooleanToggleWithoutFunctionalUpdate,
      `const Cursor = () => {
         const [visible, setVisible] = useState(true);
         useEffect(() => {
           const intervalId = setInterval(() => setVisible(!visible), 500);
           return () => clearInterval(intervalId);
         }, []);
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a state-dep effect toggle with no cleanup", () => {
    const result = runRule(
      noBooleanToggleWithoutFunctionalUpdate,
      `const Poller = () => {
         const [on, setOn] = useState(false);
         useEffect(() => {
           setTimeout(() => setOn(!on), 500);
         }, [on]);
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags window timers and promise rejection callbacks", () => {
    const windowTimer = runRule(
      noBooleanToggleWithoutFunctionalUpdate,
      "const C = () => { const [open, setOpen] = useState(false); window.setTimeout(() => setOpen(!open), 1); };",
    );
    const promiseCatch = runRule(
      noBooleanToggleWithoutFunctionalUpdate,
      "const C = () => { const [open, setOpen] = useState(false); load().catch(() => setOpen(!open)); };",
    );
    const promiseFinally = runRule(
      noBooleanToggleWithoutFunctionalUpdate,
      "const C = () => { const [open, setOpen] = useState(false); load().finally(() => setOpen(!open)); };",
    );
    const workerTimer = runRule(
      noBooleanToggleWithoutFunctionalUpdate,
      "const C = () => { const [open, setOpen] = useState(false); self.setTimeout(() => setOpen(!open), 1); };",
    );
    const shadowedWorker = runRule(
      noBooleanToggleWithoutFunctionalUpdate,
      "const self={setTimeout:callback=>callback()};const C=()=>{const[open,setOpen]=useState(false);self.setTimeout(()=>setOpen(!open),1)};",
    );
    expect(windowTimer.diagnostics).toHaveLength(1);
    expect(promiseCatch.diagnostics).toHaveLength(1);
    expect(promiseFinally.diagnostics).toHaveLength(1);
    expect(workerTimer.diagnostics).toHaveLength(1);
    expect(shadowedWorker.diagnostics).toHaveLength(0);
  });

  it("flags subscription callbacks even without cleanup", () => {
    const result = runRule(
      noBooleanToggleWithoutFunctionalUpdate,
      "const C = () => { const [open, setOpen] = useState(false); useEffect(() => { source.subscribe(() => setOpen(!open)); }, []); };",
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not accept stale or opposite-branch ref guards", () => {
    const staleRef = runRule(
      noBooleanToggleWithoutFunctionalUpdate,
      "const C = () => { const [open, setOpen] = useState(false); const ref = useRef(open); setTimeout(() => { if (ref.current === open) setOpen(!open); }, 1); };",
    );
    const oppositeBranch = runRule(
      noBooleanToggleWithoutFunctionalUpdate,
      "const C = () => { const [open, setOpen] = useState(false); const ref = useRef(open); ref.current = open; setTimeout(() => { if (ref.current === open) return; else setOpen(!open); }, 1); };",
    );
    expect(staleRef.diagnostics).toHaveLength(1);
    expect(oppositeBranch.diagnostics).toHaveLength(1);
  });

  it("does not treat an unrelated set command as an absolute mirror", () => {
    const result = runRule(
      noBooleanToggleWithoutFunctionalUpdate,
      'const C = () => { const [open, setOpen] = useState(false); api.setPreference("other", !open).then(() => setOpen(!open)); };',
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("handles ordinary two-argument event listeners without crashing", () => {
    const result = runRule(
      noBooleanToggleWithoutFunctionalUpdate,
      'const C=()=>{const[open,setOpen]=useState(false);useEffect(()=>{document.addEventListener("click",()=>setOpen(!open))},[])}',
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts matching event and subscription cleanup when state resubscribes", () => {
    const eventListener = runRule(
      noBooleanToggleWithoutFunctionalUpdate,
      'const C=()=>{const[open,setOpen]=useState(false);useEffect(()=>{const toggle=()=>setOpen(!open);document.addEventListener("click",toggle);return()=>document.removeEventListener("click",toggle)},[open])}',
    );
    const subscription = runRule(
      noBooleanToggleWithoutFunctionalUpdate,
      "const C=()=>{const[open,setOpen]=useState(false);useEffect(()=>{const subscription=source.subscribe(()=>setOpen(!open));return()=>subscription.unsubscribe()},[open])}",
    );
    expect(eventListener.diagnostics).toHaveLength(0);
    expect(subscription.diagnostics).toHaveLength(0);
  });

  it("accepts a stable named timer cleanup when state resubscribes", () => {
    const result = runRule(
      noBooleanToggleWithoutFunctionalUpdate,
      "const C=()=>{const[open,setOpen]=useState(false);useEffect(()=>{const id=setInterval(()=>setOpen(!open),100);const cleanup=()=>clearInterval(id);return cleanup},[open])}",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("rejects reassigned, uninvoked, and mismatched named timer cleanup", () => {
    const reassigned = runRule(
      noBooleanToggleWithoutFunctionalUpdate,
      "const C=()=>{const[open,setOpen]=useState(false);useEffect(()=>{const id=setInterval(()=>setOpen(!open),100);let cleanup=()=>clearInterval(id);cleanup=()=>{};return cleanup},[open])}",
    );
    const uninvoked = runRule(
      noBooleanToggleWithoutFunctionalUpdate,
      "const C=()=>{const[open,setOpen]=useState(false);useEffect(()=>{const id=setInterval(()=>setOpen(!open),100);const cleanup=()=>()=>clearInterval(id);return cleanup},[open])}",
    );
    const mismatched = runRule(
      noBooleanToggleWithoutFunctionalUpdate,
      "const C=()=>{const[open,setOpen]=useState(false);useEffect(()=>{const id=setInterval(()=>setOpen(!open),100);const otherId=setInterval(()=>{},100);const cleanup=()=>clearInterval(otherId);return cleanup},[open])}",
    );
    expect(reassigned.diagnostics).toHaveLength(1);
    expect(uninvoked.diagnostics).toHaveLength(1);
    expect(mismatched.diagnostics).toHaveLength(1);
  });

  it("does not treat mutually exclusive correlated await paths as stale", () => {
    const result = runRule(
      noBooleanToggleWithoutFunctionalUpdate,
      "const C=({flag})=>{const[open,setOpen]=useState(false);const run=async()=>{if(flag)await load();if(flag)return;setOpen(!open)};return run}",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("caches await reachability across many setters", () => {
    const buildSource = (setterCount: number): string =>
      `const C=()=>{const[open,setOpen]=useState(false);const run=async()=>{await load();${"setOpen(!open);".repeat(setterCount)}}}`;
    runRule(noBooleanToggleWithoutFunctionalUpdate, buildSource(100));
    const measureFastestDuration = (setterCount: number): number => {
      let fastestDuration = Number.POSITIVE_INFINITY;
      for (let repetition = 0; repetition < 3; repetition += 1) {
        const start = performance.now();
        const result = runRule(noBooleanToggleWithoutFunctionalUpdate, buildSource(setterCount));
        fastestDuration = Math.min(fastestDuration, performance.now() - start);
        expect(result.diagnostics).toHaveLength(setterCount);
      }
      return fastestDuration;
    };
    const smallDuration = measureFastestDuration(2_000);
    const largeDuration = measureFastestDuration(10_000);
    expect(largeDuration).toBeLessThan(smallDuration * 18);
  });

  it("proves cleanup identity, correlated paths, and render-time ref freshness", () => {
    const animationFrame = runRule(
      noBooleanToggleWithoutFunctionalUpdate,
      "const C=()=>{const[open,setOpen]=useState(false);useEffect(()=>{const id=requestAnimationFrame(()=>setOpen(!open));return()=>cancelAnimationFrame(id)},[open])}",
    );
    const captureMismatch = runRule(
      noBooleanToggleWithoutFunctionalUpdate,
      'const C=()=>{const[open,setOpen]=useState(false);useEffect(()=>{const toggle=()=>setOpen(!open);document.addEventListener("click",toggle,{capture:true});return()=>document.removeEventListener("click",toggle)},[open])}',
    );
    const unreachableCleanup = runRule(
      noBooleanToggleWithoutFunctionalUpdate,
      'const C=()=>{const[open,setOpen]=useState(false);useEffect(()=>{const toggle=()=>setOpen(!open);document.addEventListener("click",toggle);return()=>{if(false)document.removeEventListener("click",toggle)}},[open])}',
    );
    const namedEffect = runRule(
      noBooleanToggleWithoutFunctionalUpdate,
      "const C=()=>{const[open,setOpen]=useState(false);const install=()=>{const id=setInterval(()=>setOpen(!open),100);return()=>clearInterval(id)};useEffect(install,[open])}",
    );
    const correlatedAwait = runRule(
      noBooleanToggleWithoutFunctionalUpdate,
      "const C=({flag})=>{const[open,setOpen]=useState(false);const run=async()=>{if(flag===true)await load();if(flag===false)setOpen(!open)};return run}",
    );
    const renderFreshRef = runRule(
      noBooleanToggleWithoutFunctionalUpdate,
      "const C=()=>{const[open,setOpen]=useState(false);const ref=useRef(open);useEffect(()=>{const id=setTimeout(()=>{if(ref.current===open)setOpen(!open)},1);return()=>clearTimeout(id)},[]);ref.current=open}",
    );
    expect(animationFrame.diagnostics).toHaveLength(0);
    expect(captureMismatch.diagnostics).toHaveLength(1);
    expect(unreachableCleanup.diagnostics).toHaveLength(1);
    expect(namedEffect.diagnostics).toHaveLength(0);
    expect(correlatedAwait.diagnostics).toHaveLength(0);
    expect(renderFreshRef.diagnostics).toHaveLength(0);
  });
});
