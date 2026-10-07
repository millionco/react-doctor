import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { nextjsNoAElement } from "./nextjs-no-a-element.js";

describe("Next Link anchor children", () => {
  it.each(["Link", "Navigate"])("accepts a direct anchor child of imported %s", (name) => {
    const result = runRule(
      nextjsNoAElement,
      `import ${name} from 'next/link'; const Menu = () => <${name} href='/about'><a href='/about'>About</a></${name}>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    `const Menu = () => <a href='/about'>About</a>;`,
    `import Link from './link'; const Menu = () => <Link><a href='/about'>About</a></Link>;`,
    `import Link from 'next/link'; const Menu = ({ Link }) => <Link><a href='/about'>About</a></Link>;`,
    `import Link from 'next/link'; const Menu = () => <Link href='/about'><div><a href='/about'>About</a></div></Link>;`,
  ])("still reports anchors without a direct Next Link owner", (code) => {
    expect(runRule(nextjsNoAElement, code).diagnostics).toHaveLength(1);
  });
});
