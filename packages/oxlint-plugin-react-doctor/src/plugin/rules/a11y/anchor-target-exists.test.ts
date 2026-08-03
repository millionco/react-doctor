import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { resetStaticProjectDomIdCache } from "../../utils/get-static-project-dom-ids.js";
import { anchorTargetExists } from "./anchor-target-exists.js";

let temporaryDirectory: string;

beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-anchor-target-"));
});

afterEach(() => {
  resetStaticProjectDomIdCache();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

const runProjectRule = (code: string) => {
  const filename = path.join(temporaryDirectory, "src", "app.tsx");
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, code, "utf8");
  fs.writeFileSync(path.join(temporaryDirectory, "package.json"), "{}\n", "utf8");
  return runRule(anchorTargetExists, code, {
    filename,
    settings: { "react-doctor": { rootDirectory: temporaryDirectory } },
  });
};

describe("a11y/anchor-target-exists", () => {
  it("accepts a literal fragment with a same-file target", () => {
    const result = runProjectRule(
      `const Valid = () => <><a href="#about">About</a><section id="about" /></>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("reports a literal fragment without a project target", () => {
    const result = runProjectRule(`const Broken = () => <a href="#about">About</a>;`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("ignores dynamic fragment hrefs", () => {
    const result = runProjectRule(
      "const Dynamic = ({ target }) => <a href={`#${target}`}>Section</a>;",
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("allows the empty document-top fragment and non-fragment links", () => {
    const result = runProjectRule(
      `const Links = () => <><a href="#">Top</a><a href="https://example.com/#about">External</a><a href="mailto:user@example.com">Mail</a><a href="tel:+15551212">Call</a></>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("accepts a target in another JSX file", () => {
    fs.mkdirSync(path.join(temporaryDirectory, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(temporaryDirectory, "src", "about.tsx"),
      `export const About = () => <section id="about" />;`,
      "utf8",
    );
    const result = runProjectRule(`const Link = () => <a href="#about">About</a>;`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("accepts a target in an HTML file", () => {
    fs.writeFileSync(
      path.join(temporaryDirectory, "index.html"),
      `<main id="about"></main>`,
      "utf8",
    );
    const result = runProjectRule(`const Link = () => <a href="#about">About</a>;`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not accept a different literal id", () => {
    fs.writeFileSync(
      path.join(temporaryDirectory, "other.html"),
      `<main id="contact"></main>`,
      "utf8",
    );
    const result = runProjectRule(`const Link = () => <a href="#about">About</a>;`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
