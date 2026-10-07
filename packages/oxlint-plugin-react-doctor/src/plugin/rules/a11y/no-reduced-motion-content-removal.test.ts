import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noReducedMotionContentRemoval } from "./no-reduced-motion-content-removal.js";

describe("no-reduced-motion-content-removal", () => {
  it("does not interpret Tailwind syntax when the capability is unavailable", () => {
    const result = runRule(
      noReducedMotionContentRemoval,
      `const Status = () => <p className="motion-reduce:hidden">Payment failed</p>;`,
      { settings: { "react-doctor": { capabilities: [] } } },
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("reports static text, interactive controls, and live regions hidden under reduced motion", () => {
    const result = runRule(
      noReducedMotionContentRemoval,
      `const Example = ({ error }) => <>
        <p className="motion-reduce:hidden">Payment failed</p>
        <section className="motion-reduce:invisible"><button type="button">Retry</button></section>
        <div className="motion-reduce:hidden" role="status">Saving</div>
        <div className="motion-reduce:hidden" aria-live="assertive">{error}</div>
        <output className="motion-reduce:hidden">{error}</output>
        <p className="motion-reduce:hidden" style={{ color: "red", display: "block" }}>Session expired</p>
      </>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(6);
  });

  it("reports effective responsive and important reduced-motion removals", () => {
    const result = runRule(
      noReducedMotionContentRemoval,
      `const Example = () => <>
        <p className="md:motion-reduce:hidden">Compact details</p>
        <p className="block motion-reduce:hidden">Account status</p>
        <p className="motion-reduce:!invisible visible">Connection lost</p>
        <p className="motion-reduce:!hidden motion-reduce:block">Upload failed</p>
      </>;`,
    );
    expect(result.diagnostics).toHaveLength(4);
  });

  it("requires the removed subtree and its ancestors to be visible before reduced motion", () => {
    const result = runRule(
      noReducedMotionContentRemoval,
      `const Example = ({ className }) => <>
        <section><p className="hidden motion-reduce:hidden">Already hidden</p></section>
        <section><p className="motion-safe:hidden motion-reduce:hidden">Hidden in both modes</p></section>
        <section hidden><p className="motion-reduce:hidden">Hidden ancestor</p></section>
        <section className={className}><p className="motion-reduce:hidden">Unknown ancestor</p></section>
        <Wrapper><p className="motion-reduce:hidden">Opaque ancestor</p></Wrapper>
        <section><div className="motion-reduce:hidden"><p className="motion-reduce:hidden">One removal</p></div></section>
      </>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("requires Tailwind removals to directly reach a component render", () => {
    const result = runRule(
      noReducedMotionContentRemoval,
      `const Example = () => {
        const unused = <p className="motion-reduce:hidden">Detached</p>;
        const callback = () => <p className="motion-reduce:hidden">Callback</p>;
        [1].map(() => <p className="motion-reduce:hidden">Detached map result</p>);
        return <p className="motion-reduce:hidden">Rendered</p>;
      };
      const UnreachableLogical = () => <>{false && <p className="motion-reduce:hidden">Unreachable logical branch</p>}</>;
      const UnreachableConditional = () => <>{true ? <p>Reachable branch</p> : <p className="motion-reduce:hidden">Unreachable conditional branch</p>}</>;
      const lowercaseHelper = () => <p className="motion-reduce:hidden">Helper</p>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports exact null branches from imported useReducedMotion hooks", () => {
    const result = runRule(
      noReducedMotionContentRemoval,
      `import { useReducedMotion, useReducedMotion as useMotionPreference } from "motion/react";
       import * as Motion from "framer-motion";
       const A = () => useReducedMotion() ? null : <p>Upload complete</p>;
       const B = () => { const shouldReduceMotion = useMotionPreference(); return shouldReduceMotion ? null : <button type="button">Retry</button>; };
       const C = () => { const shouldReduceMotion = Motion.useReducedMotion(); return !shouldReduceMotion ? <div role="status">Saved</div> : null; };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(3);
  });

  it("requires a useReducedMotion conditional to directly reach rendered output", () => {
    const result = runRule(
      noReducedMotionContentRemoval,
      `import { useReducedMotion } from "motion/react";
       const Example = () => {
         const reduced = useReducedMotion();
         const unused = reduced ? null : <p>Unused</p>;
         const metadata = { view: reduced ? null : <p>Metadata</p> };
         const callback = () => reduced ? null : <p>Callback result</p>;
         [1].map(() => reduced ? null : <p>Detached map result</p>);
         return <main>{reduced ? null : <p>Rendered</p>}</main>;
       };
       const Unreachable = () => { const reduced = useReducedMotion(); return <>{false && (reduced ? null : <p>Unreachable</p>)}</>; };
       const lowercaseHelper = () => useReducedMotion() ? null : <p>Helper result</p>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("requires visible hook-branch ancestors and no possible persistent fallback", () => {
    const result = runRule(
      noReducedMotionContentRemoval,
      `import { useReducedMotion } from "motion/react";
       const Example = ({ fallback }) => {
         const reduced = useReducedMotion();
         return <>
           <section hidden>{reduced ? null : <p>Hidden ancestor</p>}</section>
           <div><p>Saved</p>{reduced ? null : <p>Saved</p>}</div>
           <div>{fallback}{reduced ? null : <p>Unknown fallback</p>}</div>
         </>;
       };`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("evaluates hook sibling fallbacks in the reduced-motion state", () => {
    const result = runRule(
      noReducedMotionContentRemoval,
      `import { useReducedMotion } from "motion/react";
       const HasFallback = () => {
         const reduced = useReducedMotion();
         return <div><p className="motion-safe:hidden motion-reduce:block">Saved</p>{reduced ? null : <p>Saved</p>}</div>;
       };
       const NoFallback = () => {
         const reduced = useReducedMotion();
         return <div><p className="motion-reduce:hidden">Deleted in reduced motion</p>{reduced ? null : <p>Saved</p>}</div>;
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows effective visibility overrides and ambiguous Tailwind precedence", () => {
    const result = runRule(
      noReducedMotionContentRemoval,
      `const Example = () => <>
        <p className="motion-reduce:hidden motion-reduce:block">Saved</p>
        <p className="motion-reduce:invisible motion-reduce:visible">Saved</p>
        <p className="motion-reduce:hidden motion-reduce:!block">Saved</p>
        <p className="motion-reduce:invisible motion-reduce:!visible">Saved</p>
        <p className="!block motion-reduce:hidden">Saved</p>
        <p className="!visible motion-reduce:invisible">Saved</p>
      </>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("preserves ambiguous Tailwind visibility on ancestors", () => {
    const result = runRule(
      noReducedMotionContentRemoval,
      `const Example = () => <>
        <div className="motion-reduce:block motion-reduce:hidden">
          <p className="motion-reduce:hidden">Ambiguous display ancestor</p>
        </div>
        <div className="motion-reduce:visible motion-reduce:invisible">
          <p className="motion-reduce:hidden">Ambiguous visibility ancestor</p>
        </div>
      </>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("resolves arbitrary Tailwind display and visibility utilities conservatively", () => {
    const result = runRule(
      noReducedMotionContentRemoval,
      `const Example = () => <>
        <div><p className="motion-reduce:hidden motion-reduce:[display:block]">Ambiguous display</p></div>
        <div><p className="motion-reduce:hidden motion-reduce:![display:block]">Visible display</p></div>
        <div><p className="motion-reduce:!hidden motion-reduce:[display:block]">Hidden display</p></div>
        <div><p className="motion-reduce:invisible motion-reduce:[visibility:visible]">Ambiguous visibility</p></div>
        <div><p className="motion-reduce:hidden motion-reduce:[display:var(--display)]">Unknown display</p></div>
      </>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows descendants to override an inherited invisible state", () => {
    const result = runRule(
      noReducedMotionContentRemoval,
      `const Example = () => <>
        <div className="motion-reduce:invisible"><span className="motion-reduce:visible">Saved</span></div>
        <div className="motion-reduce:invisible"><span style={{ visibility: "visible" }}>Saved</span></div>
      </>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("rejects contradictory motion variants and empty responsive intervals", () => {
    const result = runRule(
      noReducedMotionContentRemoval,
      `const Example = () => <>
        <p className="motion-safe:motion-reduce:hidden">Impossible preference</p>
        <p className="hover:not-hover:motion-reduce:hidden">Impossible interaction</p>
        <p className="md:max-sm:motion-reduce:hidden">Impossible breakpoint</p>
        <p className="max-md:lg:motion-reduce:hidden">Another impossible breakpoint</p>
      </>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("skips unsupported Tailwind variant scopes", () => {
    const result = runRule(
      noReducedMotionContentRemoval,
      `const Example = () => <>
        <p className="motion-reduce:hover:hidden">Interaction state</p>
        <p className="motion-reduce:data-[state=open]:hidden">Data state</p>
        <p className="motion-reduce:group-hover:hidden">Group state</p>
        <p className="motion-reduce/compact:hidden">Modified preference variant</p>
        <p className="motion-reduce:max-[700px]:hidden">Arbitrary breakpoint</p>
        <p className="motion-reduce:tablet:hidden">Custom breakpoint</p>
      </>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("allows equivalent persistent text and actions", () => {
    const result = runRule(
      noReducedMotionContentRemoval,
      `const Example = ({ save }) => <>
        <div><span className="motion-reduce:hidden">Loading account</span><span>Loading account</span></div>
        <div><button className="motion-reduce:hidden" type="submit">Save</button><button className="hidden motion-reduce:block" type="submit">Save</button></div>
        <div><button className="motion-reduce:hidden" type="button" onClick={save}>Save</button><button type="button" onClick={save}>Save</button></div>
        <div><a className="motion-reduce:invisible" href="/settings">Settings</a><a href="/settings">Settings</a></div>
      </>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("finds equivalent reduced-motion fallbacks in neighboring neutral wrappers", () => {
    const result = runRule(
      noReducedMotionContentRemoval,
      `const Example = () => <section>
        <div><p className="motion-reduce:hidden">Saved</p></div>
        <div className="hidden motion-reduce:block"><p>Saved</p></div>
      </section>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("finds descendant-switched fallbacks in neighboring section wrappers", () => {
    const result = runRule(
      noReducedMotionContentRemoval,
      `const Example = () => <>
        <section><p className="motion-reduce:hidden">Saved</p></section>
        <section><p className="hidden motion-reduce:block">Saved</p></section>
      </>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not cross interactive, live-region, or named-region wrapper boundaries", () => {
    const result = runRule(
      noReducedMotionContentRemoval,
      `const Example = () => <>
        <button><span className="motion-reduce:hidden">Save</span></button>
        <button><span className="hidden motion-reduce:block">Save</span></button>
        <section role="status"><p className="motion-reduce:hidden">Saved</p></section>
        <section role="status"><p className="hidden motion-reduce:block">Saved</p></section>
        <section aria-label="Primary status"><p className="motion-reduce:hidden">Ready</p></section>
        <section aria-label="Reduced status"><p className="hidden motion-reduce:block">Ready</p></section>
      </>;`,
    );
    expect(result.diagnostics).toHaveLength(3);
  });

  it("abstains when an opaque or dynamic sibling could be an equivalent fallback", () => {
    const result = runRule(
      noReducedMotionContentRemoval,
      `const Example = ({ fallback, className }) => <>
        <div><p className="motion-reduce:hidden">Saved</p><Fallback /></div>
        <div><p className="motion-reduce:hidden">Saved</p>{fallback}</div>
        <div><p className="motion-reduce:hidden">Saved</p><span className={className}>Saved</span></div>
        <div><p className="motion-reduce:hidden">Saved</p><span><i className={className}>Saved</i></span></div>
      </>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not mistake same-looking but non-equivalent content for a fallback", () => {
    const result = runRule(
      noReducedMotionContentRemoval,
      `const Example = ({ retry, cancel }) => <>
        <div><button className="motion-reduce:hidden" type="button">Retry</button><span>Retry</span></div>
        <div><a className="motion-reduce:hidden" href="/billing">Settings</a><a href="/profile">Settings</a></div>
        <div><p className="motion-reduce:hidden">Saving</p><p>Saved</p></div>
        <div><button className="motion-reduce:hidden" type="button" onClick={retry}>Retry</button><button type="button" onClick={cancel}>Retry</button></div>
        <div><button className="motion-reduce:hidden" type="submit">Save</button><button type="submit" disabled>Save</button></div>
      </>;`,
    );
    expect(result.diagnostics).toHaveLength(5);
  });

  it("includes form submission behavior when comparing buttons with click handlers", () => {
    const result = runRule(
      noReducedMotionContentRemoval,
      `const Example = ({ save }) => <>
        <div><button className="motion-reduce:hidden" type="submit" formAction="/save" onClick={save}>Save</button><button type="submit" formAction="/draft" onClick={save}>Save</button></div>
        <div><button className="motion-reduce:hidden" type="reset" formAction="/save" onClick={save}>Reset</button><button type="reset" formAction="/save" onClick={save}>Reset</button></div>
      </>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("skips decorative, already hidden, empty, spinner-only, and opaque subtrees", () => {
    const result = runRule(
      noReducedMotionContentRemoval,
      `const Example = () => <>
        <span className="animate-spin motion-reduce:hidden" aria-hidden="true">Loading</span>
        <span className="motion-reduce:hidden"><svg><title>Spinner</title></svg></span>
        <span className="motion-reduce:hidden"><Spinner /></span>
        <template className="motion-reduce:hidden"><p>Deferred content</p></template>
        <span className="motion-reduce:hidden" />
        <Status className="motion-reduce:hidden">Saved</Status>
        <span className="motion-reduce:hidden" hidden>Saved</span>
      </>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not treat inert template contents as a visible fallback", () => {
    const result = runRule(
      noReducedMotionContentRemoval,
      `const Example = () => <div>
        <p className="motion-reduce:hidden">Saved</p>
        <template><p>Saved</p></template>
      </div>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps traversing meaningful descendants of presentational wrappers", () => {
    const result = runRule(
      noReducedMotionContentRemoval,
      `const Example = ({ retry }) => <>
        <div className="motion-reduce:hidden" role="presentation">System offline</div>
        <div className="motion-reduce:hidden" role="none"><button type="button" onClick={retry}>Retry</button></div>
      </>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("skips dynamic classes, spreads, hidden semantics, and custom opaque content", () => {
    const result = runRule(
      noReducedMotionContentRemoval,
      `const Example = ({ className, props, hidden }) => <>
        <p className={className}>Saved</p>
        <p className="motion-reduce:hidden" {...props}>Saved</p>
        <p className="motion-reduce:hidden" aria-hidden={hidden}>Saved</p>
        <div className="motion-reduce:hidden"><Panel /></div>
        <div className="motion-reduce:hidden"><span className={className}>Saved</span></div>
        <p className="motion-reduce:hidden" style={{ display: "none" }}>Saved</p>
        <p className="motion-reduce:hidden" style={{ visibility: "hidden" }}>Saved</p>
        <p className="motion-reduce:hidden" style={{ display: "var(--display)" }}>Saved</p>
        <p className="motion-reduce:hidden" style={{ visibility: "var(--visibility)" }}>Saved</p>
        <p className="motion-reduce:hidden" style={props}>Saved</p>
      </>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("preserves unknown attribute states and ignores unsupported unnamed controls", () => {
    const result = runRule(
      noReducedMotionContentRemoval,
      `const Example = ({ role, live, label, href, action }) => <>
        <div className="motion-reduce:hidden" role={role}>{action}</div>
        <div className="motion-reduce:hidden" aria-live={live}>{action}</div>
        <button className="motion-reduce:hidden" type="button" aria-label={label} />
        <a className="motion-reduce:hidden" href={href} aria-label="Account" />
        <button className="motion-reduce:hidden" formAction={action} aria-label="Save" />
        <button className="motion-reduce:hidden" aria-labelledby="external-label" />
        <input className="motion-reduce:hidden" aria-label="Email" />
        <video className="motion-reduce:hidden" />
      </>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("recognizes numeric and static-template text and HTML boolean disabled presence", () => {
    const result = runRule(
      noReducedMotionContentRemoval,
      'const Example = ({ save }) => <><p className="motion-reduce:hidden">{42}</p><p className="motion-reduce:hidden">{`Saved`}</p><button className="motion-reduce:hidden" disabled="false" onClick={save} aria-label="Save" /></>;',
    );
    expect(result.diagnostics).toHaveLength(3);
  });

  it("skips shadowed and unrelated useReducedMotion functions", () => {
    const result = runRule(
      noReducedMotionContentRemoval,
      `import { useReducedMotion as importedPreference } from "motion/react";
       import { useReducedMotion as useOtherPreference } from "other-motion";
       const A = () => { const useReducedMotion = () => true; return useReducedMotion() ? null : <p>Saved</p>; };
       const B = () => useOtherPreference() ? null : <p>Saved</p>;
       const C = () => { const importedPreference = () => true; return importedPreference() ? null : <p>Saved</p>; };`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("skips hook branches that preserve content or cannot prove removal", () => {
    const result = runRule(
      noReducedMotionContentRemoval,
      `import { useReducedMotion } from "motion/react";
       const A = () => { const reduced = useReducedMotion(); return reduced ? <p>Static summary</p> : null; };
       const B = () => { const reduced = useReducedMotion(); return reduced ? <p>Static summary</p> : <p>Animated summary</p>; };
       const C = () => { let reduced = useReducedMotion(); return reduced ? null : <p>Saved</p>; };
       const D = ({ reduced }) => reduced ? null : <p>Saved</p>;
       const E = () => useReducedMotion() ? null : <Spinner />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });
});
