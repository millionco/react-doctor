import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noRepeatedPlaceholderNavigation } from "./no-repeated-placeholder-navigation.js";

describe("no-repeated-placeholder-navigation", () => {
  it("reports one diagnostic for repeated placeholder links in a navigation container", () => {
    const result = runRule(
      noRepeatedPlaceholderNavigation,
      `const Sidebar = () => <nav><a href="#">Home</a><a href="#">Projects</a><a href="#">Settings</a></nav>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.nodeType).toBe("JSXOpeningElement");
  });

  it("reports placeholder links nested through static elements and fragments", () => {
    const result = runRule(
      noRepeatedPlaceholderNavigation,
      `const Sidebar = () => <aside><ul><li><a href={'#'}>Inbox</a></li></ul><><div><a href="#">Archive</a></div></></aside>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows a single placeholder link", () => {
    const result = runRule(
      noRepeatedPlaceholderNavigation,
      `const Navigation = () => <nav><a href="#">Pending</a><a href="/settings">Settings</a></nav>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("allows real fragment destinations", () => {
    const result = runRule(
      noRepeatedPlaceholderNavigation,
      `const TableOfContents = () => <aside><a href="#overview">Overview</a><a href="#examples">Examples</a><a href="#api">API</a></aside>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not count dynamic hrefs or anchors with spread attributes", () => {
    const result = runRule(
      noRepeatedPlaceholderNavigation,
      `const Navigation = ({ firstHref, secondHref, linkProps }) => <nav><a href={firstHref}>One</a><a href={secondHref}>Two</a><a href="#" {...linkProps}>Three</a><a {...linkProps} href="#">Four</a></nav>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("only counts native anchors inside nav or aside containers", () => {
    const result = runRule(
      noRepeatedPlaceholderNavigation,
      `const Links = () => <><div><a href="#">One</a><a href="#">Two</a></div><nav><Link href="#">Three</Link><A href="#">Four</A></nav><Navigation><a href="#">Five</a><a href="#">Six</a></Navigation></>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("requires two placeholder anchors that statically coexist", () => {
    const result = runRule(
      noRepeatedPlaceholderNavigation,
      `const Navigation = ({ active }) => <nav><a href="#">Always</a>{active ? <a href="#">Active</a> : <a href="#">Inactive</a>}</nav>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("reports each separate qualifying container once", () => {
    const result = runRule(
      noRepeatedPlaceholderNavigation,
      `const Layout = () => <><nav><a href="#">One</a><a href="#">Two</a></nav><aside><a href="#">Three</a><a href="#">Four</a></aside></>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("does not duplicate the finding for a nav nested in an aside", () => {
    const result = runRule(
      noRepeatedPlaceholderNavigation,
      `const Sidebar = () => <aside><nav><a href="#">One</a><a href="#">Two</a></nav></aside>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("skips test-like files", () => {
    const result = runRule(
      noRepeatedPlaceholderNavigation,
      `const Navigation = () => <nav><a href="#">One</a><a href="#">Two</a></nav>;`,
      { filename: "/project/src/navigation.test.tsx" },
    );
    expect(result.diagnostics).toEqual([]);
  });
});
