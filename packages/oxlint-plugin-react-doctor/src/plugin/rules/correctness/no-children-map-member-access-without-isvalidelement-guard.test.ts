import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noChildrenMapMemberAccessWithoutIsvalidelementGuard } from "./no-children-map-member-access-without-isvalidelement-guard.js";

describe("no-children-map-member-access-without-isvalidelement-guard", () => {
  it("flags a double member on props inside a Children.map callback", () => {
    const result = runRule(
      noChildrenMapMemberAccessWithoutIsvalidelementGuard,
      `React.Children.map(children, (child) => (
        <div className={child.props.className}>{child}</div>
      ));`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a double member on type inside a forEach callback", () => {
    const result = runRule(
      noChildrenMapMemberAccessWithoutIsvalidelementGuard,
      `React.Children.forEach(children, (child) => {
        const role = child.type.role;
        register(role);
      });`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a double member on a map over a toArray result", () => {
    const result = runRule(
      noChildrenMapMemberAccessWithoutIsvalidelementGuard,
      `React.Children.toArray(children).map((child) =>
        cloneElement(child, { active: child.props.value === selected })
      );`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet when guarded with isValidElement", () => {
    const result = runRule(
      noChildrenMapMemberAccessWithoutIsvalidelementGuard,
      `React.Children.map(children, (child) =>
        isValidElement(child)
          ? cloneElement(child, { className: child.props.className })
          : child
      );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when guarded with a typeof-string check", () => {
    const result = runRule(
      noChildrenMapMemberAccessWithoutIsvalidelementGuard,
      `Children.map(children, (child) => {
        if (typeof child === "string" || typeof child === "number") return child;
        return child.props.className;
      });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for a bare single-level type comparison", () => {
    const result = runRule(
      noChildrenMapMemberAccessWithoutIsvalidelementGuard,
      `Children.forEach(children, (child) => {
        if (child.type === Tab) count++;
      });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for the pure cloneElement shape", () => {
    const result = runRule(
      noChildrenMapMemberAccessWithoutIsvalidelementGuard,
      `React.Children.map(children, (child) =>
        isValidElement(child) ? cloneElement(child, { onSelect }) : child
      );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for a bare single-level props read", () => {
    const result = runRule(
      noChildrenMapMemberAccessWithoutIsvalidelementGuard,
      `Children.map(children, (child) => child.props);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when the double access uses optional chaining", () => {
    const result = runRule(
      noChildrenMapMemberAccessWithoutIsvalidelementGuard,
      `React.Children.map(children, (child) => child.props?.className);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for an ordinary array map that is not a Children iteration", () => {
    const result = runRule(
      noChildrenMapMemberAccessWithoutIsvalidelementGuard,
      `items.map((child) => child.props.className);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
