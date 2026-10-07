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

const runProjectRule = (code: string, relativeFilePath = "src/app.tsx") => {
  const filename = path.join(temporaryDirectory, relativeFilePath);
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

  it("accepts a target id resolved through a const alias", () => {
    const result = runProjectRule(
      `const SECTION_ID = "about"; const Valid = () => <><a href="#about">About</a><section id={SECTION_ID} /></>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("keeps known target ids from partially dynamic expressions", () => {
    const result = runProjectRule(
      `const Valid = ({ condition, name }) => <><a href="#about">About</a><section id={condition ? "about" : name} /></>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("keeps known target ids from dynamic nullish and falsy defaults", () => {
    const result = runProjectRule(
      `const Valid = (props) => <><a href="#about">About</a><a href="#contact">Contact</a><section id={props.id ?? "about"} /><section id={props.otherId || "contact"} /></>;`,
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

  it("allows document-top fragments and non-fragment links", () => {
    const result = runProjectRule(
      `const Links = () => <><a href="#">Top</a><a href="#top">Top</a><a href="#TOP">Top</a><a href="https://example.com/#about">External</a><a href="mailto:user@example.com">Mail</a><a href="tel:+15551212">Call</a></>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("ignores hash-router paths", () => {
    const result = runProjectRule(
      `const Links = () => <><a href="#/about">About</a><a href="#!/settings">Settings</a></>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("ignores text fragment directives", () => {
    const result = runProjectRule(
      `const Link = () => <a href="#:~:text=React%20Doctor">React Doctor</a>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("validates the element id before a text fragment directive", () => {
    const validResult = runProjectRule(
      `const Link = () => <><a href="#about:~:text=React%20Doctor">React Doctor</a><main id="about" /></>;`,
    );
    expect(validResult.parseErrors).toEqual([]);
    expect(validResult.diagnostics).toEqual([]);

    resetStaticProjectDomIdCache();
    const brokenResult = runProjectRule(
      `const Link = () => <a href="#missing:~:text=React%20Doctor">React Doctor</a>;`,
    );
    expect(brokenResult.parseErrors).toEqual([]);
    expect(brokenResult.diagnostics).toHaveLength(1);
    expect(brokenResult.diagnostics[0]?.message).toContain('"#missing"');
  });

  it("reports a missing target on a configured anchor component", () => {
    const result = runRule(
      anchorTargetExists,
      `const Link = () => <NavigationLink href="#about">About</NavigationLink>;`,
      { settings: { "jsx-a11y": { components: { NavigationLink: "a" } } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts a target used by a configured anchor component", () => {
    const result = runRule(
      anchorTargetExists,
      `const Link = () => <><NavigationLink href="#about">About</NavigationLink><main id="about" /></>;`,
      { settings: { "jsx-a11y": { components: { NavigationLink: "a" } } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("reads configured href attribute names", () => {
    const settings = {
      "jsx-a11y": {
        attributes: { href: ["to"] },
        components: { NavigationLink: "a" },
      },
    };
    const validResult = runRule(
      anchorTargetExists,
      `const Link = () => <><NavigationLink to="#about">About</NavigationLink><main id="about" /></>;`,
      { settings },
    );
    expect(validResult.parseErrors).toEqual([]);
    expect(validResult.diagnostics).toEqual([]);

    const brokenResult = runRule(
      anchorTargetExists,
      `const Link = () => <NavigationLink to="#about">About</NavigationLink>;`,
      { settings },
    );
    expect(brokenResult.parseErrors).toEqual([]);
    expect(brokenResult.diagnostics).toHaveLength(1);
  });

  it("skips testlike files", () => {
    const result = runProjectRule(
      `const Broken = () => <a href="#about">About</a>;`,
      "src/app.test.tsx",
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("accepts a same-file target outside the production project index", () => {
    const result = runProjectRule(
      `const Valid = () => <><a href="#about">About</a><section id="about" /></>;`,
      ".generated/app.tsx",
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

  it("accepts a const-aliased target in another JSX file", () => {
    fs.mkdirSync(path.join(temporaryDirectory, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(temporaryDirectory, "src", "about.tsx"),
      `const SECTION_ID = "about"; export const About = () => <section id={SECTION_ID} />;`,
      "utf8",
    );
    const result = runProjectRule(`const Link = () => <a href="#about">About</a>;`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("skips a missing-target claim when a JSX spread can provide or replace an id", () => {
    const result = runProjectRule(
      `const Link = (props) => <><a href="#about">About</a><main id="about" {...props} /></>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("resolves ids from static JSX spread objects", () => {
    const result = runProjectRule(
      `const Links = () => <><a href="#about">About</a><a href="#missing">Missing</a><main {...{ id: "about" }} /></>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain('"#missing"');
  });

  it("resolves const-aliased ids from static JSX spread objects", () => {
    const result = runProjectRule(
      `const SECTION_ID = "about"; const Link = () => <><a href="#about">About</a><main {...{ id: SECTION_ID }} /></>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("keeps known ids from static spreads containing a later dynamic spread", () => {
    const result = runProjectRule(
      `const Link = (props) => <><a href="#about">About</a><main {...{ ...{ id: "about", ...props } }} /></>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("uses the last explicit JSX id", () => {
    const result = runProjectRule(
      `const Link = () => <><a href="#about">About</a><main id="about" id="contact" /></>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat ids inside JSX template content as document targets", () => {
    const result = runProjectRule(
      `const Link = () => <><a href="#about">About</a><template><main id="about" /></template></>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts an id on the JSX template element itself", () => {
    const result = runProjectRule(
      `const Link = () => <><a href="#about">About</a><template id="about"><main id="inside" /></template></>;`,
    );
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

  it("does not treat data-id as an HTML id", () => {
    fs.writeFileSync(
      path.join(temporaryDirectory, "other.html"),
      `<main data-id="about"></main>`,
      "utf8",
    );
    const result = runProjectRule(`const Link = () => <a href="#about">About</a>;`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat id text inside another HTML attribute as an id", () => {
    fs.writeFileSync(
      path.join(temporaryDirectory, "other.html"),
      `<main title='Copy id="about"' data-copy="id=about"></main>`,
      "utf8",
    );
    const result = runProjectRule(`const Link = () => <a href="#about">About</a>;`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts an HTML id after another attribute mentions id text", () => {
    fs.writeFileSync(
      path.join(temporaryDirectory, "other.html"),
      `<main title='Copy id="wrong"' id="about"></main>`,
      "utf8",
    );
    const result = runProjectRule(`const Link = () => <a href="#about">About</a>;`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not treat comments, raw text, or visible text as HTML ids", () => {
    fs.writeFileSync(
      path.join(temporaryDirectory, "other.html"),
      `
        <!-- <main id="about"></main> -->
        <script>const markup = '<main id="about"></main>';</script>
        <style>.example::after { content: '<main id="about"></main>'; }</style>
        <p> id="about" </p>
      `,
      "utf8",
    );
    const result = runProjectRule(`const Link = () => <a href="#about">About</a>;`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts an HTML id when other text resembles markup", () => {
    fs.writeFileSync(
      path.join(temporaryDirectory, "other.html"),
      `
        <!-- <main id="wrong"></main> -->
        <script>const markup = '<main id="wrong"></main>';</script>
        <main class="shell" id="about" data-label=">"></main>
      `,
      "utf8",
    );
    const result = runProjectRule(`const Link = () => <a href="#about">About</a>;`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("accepts an id on a raw-text element while ignoring its body", () => {
    fs.writeFileSync(
      path.join(temporaryDirectory, "other.html"),
      `<script id="about">const markup = '<main id="wrong"></main>';</script>`,
      "utf8",
    );
    const result = runProjectRule(`const Link = () => <a href="#about">About</a>;`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not treat ids inside an HTML template as document targets", () => {
    fs.writeFileSync(
      path.join(temporaryDirectory, "other.html"),
      `<template><main id="about"></main></template>`,
      "utf8",
    );
    const result = runProjectRule(`const Link = () => <a href="#about">About</a>;`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts an id on the HTML template element itself", () => {
    fs.writeFileSync(
      path.join(temporaryDirectory, "other.html"),
      `<template id="about"><main id="inside"></main></template>`,
      "utf8",
    );
    const result = runProjectRule(`const Link = () => <a href="#about">About</a>;`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
