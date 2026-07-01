import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noWholeObjectDepWithMemberReads } from "./no-whole-object-dep-with-member-reads.js";

describe("no-whole-object-dep-with-member-reads", () => {
  it("flags a bare props dep when the effect only reads a member (EmailModal shape)", () => {
    const result = runRule(
      noWholeObjectDepWithMemberReads,
      `function EmailModal(props) {
        useEffect(() => {
          props.onEmailThreadFetched();
        }, [emailThreadFetchingStatus, props]);
      }`
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
      }`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a destructured prop value (identity belongs to the parent, so [user] is idiomatic)", () => {
    const result = runRule(
      noWholeObjectDepWithMemberReads,
      `function Card({ user }) {
        const label = useMemo(() => \`\${user.first} \${user.last}\`, [user]);
        return label;
      }`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when the object is spread (whole reference matters)", () => {
    const result = runRule(
      noWholeObjectDepWithMemberReads,
      `function Panel(props) {
        const merged = useMemo(() => ({ ...props }), [props]);
        return merged;
      }`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when the object is passed as an argument", () => {
    const result = runRule(
      noWholeObjectDepWithMemberReads,
      `function Panel(props) {
        useEffect(() => {
          save(props);
        }, [props]);
      }`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a member expression already listed in deps", () => {
    const result = runRule(
      noWholeObjectDepWithMemberReads,
      `function Panel(props) {
        useEffect(() => {
          use(props.requisition);
        }, [props.requisition]);
      }`
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
      }`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a dynamic index read of props", () => {
    const result = runRule(
      noWholeObjectDepWithMemberReads,
      `function Panel(props) {
        useEffect(() => {
          read(props[key]);
        }, [props]);
      }`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when the callback shadows the prop name", () => {
    const result = runRule(
      noWholeObjectDepWithMemberReads,
      `function Panel(props) {
        useEffect((props) => {
          props.onChange();
        }, [props]);
      }`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag outside a component (lowercase function)", () => {
    const result = runRule(
      noWholeObjectDepWithMemberReads,
      `function helper(props) {
        useEffect(() => {
          props.onChange();
        }, [props]);
      }`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when props is used bare in an equality check", () => {
    const result = runRule(
      noWholeObjectDepWithMemberReads,
      `function Panel(props) {
        useEffect(() => {
          if (props === prev) return;
          read(props.value);
        }, [props]);
      }`
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
