import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noUnguardedRefCurrentMemberAccess } from "./no-unguarded-ref-current-member-access.js";

describe("no-unguarded-ref-current-member-access", () => {
  it("flags unguarded .contains() inside a document handler", () => {
    const result = runRule(
      noUnguardedRefCurrentMemberAccess,
      `function C() {
        const wrapperRef = useRef(null);
        useEffect(() => {
          const onClick = (event) => {
            if (!wrapperRef.current.contains(event.target)) close();
          };
          document.addEventListener('mousedown', onClick);
          return () => document.removeEventListener('mousedown', onClick);
        }, []);
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags unguarded .focus() in a fired-late callback", () => {
    const result = runRule(
      noUnguardedRefCurrentMemberAccess,
      `function C() {
        const inputRef = useRef<HTMLInputElement>(null);
        const handler = () => inputRef.current.focus();
        return handler;
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a geometry read via an alias of .current", () => {
    const result = runRule(
      noUnguardedRefCurrentMemberAccess,
      `function C() {
        const contentRef = useRef<HTMLDivElement>(null);
        const content = contentRef.current;
        const isOverflowing = content.scrollHeight > content.clientHeight;
        return isOverflowing;
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a non-null Map container ref", () => {
    const result = runRule(
      noUnguardedRefCurrentMemberAccess,
      `function C() {
        const simRef = useRef(new Map());
        simRef.current.clear();
        simRef.current.set(id, node);
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a non-null value ref", () => {
    const result = runRule(
      noUnguardedRefCurrentMemberAccess,
      `function C() {
        const countRef = useRef(0);
        countRef.current += 1;
        return countRef.current.toFixed(0);
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an access narrowed by an early return", () => {
    const result = runRule(
      noUnguardedRefCurrentMemberAccess,
      `function C() {
        const ref = useRef(null);
        const onDown = (event) => {
          if (!ref.current) return;
          if (ref.current.contains(event.target)) return;
        };
        return onDown;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an access guarded by a multi-line && check", () => {
    const result = runRule(
      noUnguardedRefCurrentMemberAccess,
      `function C() {
        const ref = useRef(null);
        function run() {
          if (ref.current && ref.current.value.length > 0) {
            ref.current.focus();
          }
        }
        return run;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an optional-chained access", () => {
    const result = runRule(
      noUnguardedRefCurrentMemberAccess,
      `function C() {
        const ref = useRef(null);
        const onClick = (event) => {
          if (!ref.current?.contains(event.target)) close();
        };
        return onClick;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an access guarded by an optional-chained current check", () => {
    const result = runRule(
      noUnguardedRefCurrentMemberAccess,
      `function C() {
        const ref = useRef(null);
        const setFocus = () => {
          ref?.current && ref.current.focus();
        };
        return setFocus;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a ref whose binding is not resolvable", () => {
    const result = runRule(
      noUnguardedRefCurrentMemberAccess,
      `function C() {
        externalRef.current.focus();
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a non-hazard business member access", () => {
    const result = runRule(
      noUnguardedRefCurrentMemberAccess,
      `function C() {
        const stateRef = useRef(null);
        const total = stateRef.current.count;
        return total;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag reading .current as a call argument", () => {
    const result = runRule(
      noUnguardedRefCurrentMemberAccess,
      `function C() {
        const timerRef = useRef(null);
        clearTimeout(timerRef.current);
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
