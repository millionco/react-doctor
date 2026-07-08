import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rerenderTransitionsScroll } from "./rerender-transitions-scroll.js";

describe("performance/rerender-transitions-scroll — regressions", () => {
  // glific ChatMessages: boolean setters flip only at threshold crossings;
  // repeated same-value sets bail out via Object.is, so no per-event redraw.
  it("stays silent when the scroll handler only sets constant boolean values", () => {
    const result = runRule(
      rerenderTransitionsScroll,
      `function ChatMessages({ showJumpToLatest }) {
        const [, setShowJumpToLatest] = useState(false);
        useEffect(() => {
          const container = document.querySelector(".messageContainer");
          container.addEventListener("scroll", (event) => {
            const target = event.target;
            if (Math.round(target.scrollTop) === target.scrollHeight - target.offsetHeight) {
              setShowJumpToLatest(false);
            } else if (showJumpToLatest === false) {
              setShowJumpToLatest(true);
            }
          });
        }, []);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // cloudscape drag-handle-wrapper: setUncontrolledShowButtons(false) after a
  // drag threshold repeats the same value; React bails out, no stutter.
  it("stays silent on a constant setter behind a drag threshold in pointermove", () => {
    const result = runRule(
      rerenderTransitionsScroll,
      `function DragHandleWrapper({ hideButtonsOnDrag, clickDragThreshold }) {
        const [, setUncontrolledShowButtons] = useState(true);
        const isPointerDown = useRef(false);
        const initialPointerPosition = useRef(null);
        const didPointerDrag = useRef(false);
        useEffect(() => {
          document.addEventListener("pointermove", (event) => {
            if (
              isPointerDown.current &&
              initialPointerPosition.current &&
              event.clientX > initialPointerPosition.current.x + clickDragThreshold
            ) {
              didPointerDrag.current = true;
              if (hideButtonsOnDrag) {
                setUncontrolledShowButtons(false);
              }
            }
          });
        }, []);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // jaeger TraceFlamegraph: the mousemove handler already deduplicates via a
  // ref-guarded early return — the rule's own suggested fix.
  it("stays silent when the mousemove handler dedupes via a ref-guarded return", () => {
    const result = runRule(
      rerenderTransitionsScroll,
      `function TraceFlamegraph() {
        const [, setTooltip] = useState(null);
        const hoveredFrameRef = useRef(null);
        useEffect(() => {
          const svgEl = document.querySelector("svg");
          svgEl.addEventListener("mousemove", (e) => {
            const target = e.target.closest("g.frame");
            if (!target) {
              if (hoveredFrameRef.current) {
                hoveredFrameRef.current = null;
                setTooltip(null);
              }
              return;
            }
            if (target === hoveredFrameRef.current) return;
            hoveredFrameRef.current = target;
            setTooltip({ x: e.clientX, y: e.clientY });
          });
        }, []);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a per-event value setter in a scroll handler", () => {
    const result = runRule(
      rerenderTransitionsScroll,
      `function ScrollTracker() {
        const [, setScrollY] = useState(0);
        useEffect(() => {
          window.addEventListener("scroll", () => {
            setScrollY(window.scrollY);
          });
        }, []);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a per-event value setter in a mousemove handler", () => {
    const result = runRule(
      rerenderTransitionsScroll,
      `function CursorTracker() {
        const [, setPosition] = useState({ x: 0, y: 0 });
        useEffect(() => {
          document.addEventListener("mousemove", (event) => {
            setPosition({ x: event.clientX, y: event.clientY });
          });
        }, []);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
