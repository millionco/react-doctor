import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noWholeObjectDepWithMemberReads } from "./no-whole-object-dep-with-member-reads.js";

describe("no-whole-object-dep-with-member-reads", () => {
  it("flags a bare props dep when the callback only reads a member (EmailModal shape, useCallback)", () => {
    const result = runRule(
      noWholeObjectDepWithMemberReads,
      `function EmailModal(props) {
        const handleFetched = useCallback(() => {
          props.onEmailThreadFetched();
        }, [emailThreadFetchingStatus, props]);
        return handleFetched;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a useMemo reading multiple members of a bare props dep", () => {
    const result = runRule(
      noWholeObjectDepWithMemberReads,
      `function FullName(props) {
        const fullName = useMemo(() => \`\${props.first} \${props.last}\`, [props]);
        return fullName;
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a useImperativeHandle whose create callback only reads props members", () => {
    const result = runRule(
      noWholeObjectDepWithMemberReads,
      `function Field(props) {
        useImperativeHandle(props.forwardedRef, () => ({ focus: () => props.onFocus() }), [props]);
        return null;
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a useCallback that only destructures props members (destructure is a static member read)", () => {
    const result = runRule(
      noWholeObjectDepWithMemberReads,
      `function Panel(props) {
        const handle = useCallback(() => {
          const { onChange } = props;
          onChange();
        }, [props]);
        return handle;
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a useEffect whole-props dep (root-mounted singletons keep a stable props reference, e.g. mapguide-react-layout App)", () => {
    const result = runRule(
      noWholeObjectDepWithMemberReads,
      `function App(props) {
        useEffect(() => {
          props.onInit(props.mapName);
        }, [props]);
        return null;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a useLayoutEffect whole-props dep (effects are excluded like useEffect)", () => {
    const result = runRule(
      noWholeObjectDepWithMemberReads,
      `function App(props) {
        useLayoutEffect(() => {
          props.onMeasure();
        }, [props]);
        return null;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a destructured prop value (identity belongs to the parent, so [user] is idiomatic)", () => {
    const result = runRule(
      noWholeObjectDepWithMemberReads,
      `function Card({ user }) {
        const label = useMemo(() => \`\${user.first} \${user.last}\`, [user]);
        return label;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when the destructure has a rest element (rest captures the remaining object)", () => {
    const result = runRule(
      noWholeObjectDepWithMemberReads,
      `function Panel(props) {
        const handle = useCallback(() => {
          const { onChange, ...rest } = props;
          onChange(rest);
        }, [props]);
        return handle;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when the destructure uses a computed key (dynamic read)", () => {
    const result = runRule(
      noWholeObjectDepWithMemberReads,
      `function Panel(props) {
        const handle = useCallback(() => {
          const { [key]: value } = props;
          use(value);
        }, [props]);
        return handle;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when the object is spread (whole reference matters)", () => {
    const result = runRule(
      noWholeObjectDepWithMemberReads,
      `function Panel(props) {
        const merged = useMemo(() => ({ ...props }), [props]);
        return merged;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when the object is passed as an argument", () => {
    const result = runRule(
      noWholeObjectDepWithMemberReads,
      `function Panel(props) {
        const handle = useCallback(() => {
          save(props);
        }, [props]);
        return handle;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a member expression already listed in deps", () => {
    const result = runRule(
      noWholeObjectDepWithMemberReads,
      `function Panel(props) {
        const value = useMemo(() => {
          return use(props.requisition);
        }, [props.requisition]);
        return value;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an object built by a hook (not a component prop)", () => {
    const result = runRule(
      noWholeObjectDepWithMemberReads,
      `function Cart() {
        const cart = useContext(CartContext);
        const total = useMemo(() => cart.state, [cart]);
        return total;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a dynamic index read of props", () => {
    const result = runRule(
      noWholeObjectDepWithMemberReads,
      `function Panel(props) {
        const value = useMemo(() => read(props[key]), [props]);
        return value;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when the callback shadows the prop name", () => {
    const result = runRule(
      noWholeObjectDepWithMemberReads,
      `function Panel(props) {
        const handle = useCallback((props) => {
          props.onChange();
        }, [props]);
        return handle;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag outside a component (lowercase function)", () => {
    const result = runRule(
      noWholeObjectDepWithMemberReads,
      `function helper(props) {
        const handle = useCallback(() => {
          props.onChange();
        }, [props]);
        return handle;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("carries the test-noise tag so test-fixture components are pipeline-skipped", () => {
    expect(noWholeObjectDepWithMemberReads.tags).toContain("test-noise");
  });

  it("does not flag when props is used bare in an equality check", () => {
    const result = runRule(
      noWholeObjectDepWithMemberReads,
      `function Panel(props) {
        const value = useMemo(() => {
          if (props === prev) return null;
          return read(props.value);
        }, [props]);
        return value;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
