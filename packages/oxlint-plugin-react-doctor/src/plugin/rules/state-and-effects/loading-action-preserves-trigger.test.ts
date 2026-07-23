import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { loadingActionPreservesTrigger } from "./loading-action-preserves-trigger.js";

const run = (source: string) => runRule(loadingActionPreservesTrigger, source);

describe("loading-action-preserves-trigger", () => {
  it("flags a button replaced by passive status text during its fetch", () => {
    const result = run(`
      import { useState } from "react";
      const Save = () => {
        const [isSaving, setIsSaving] = useState(false);
        const save = async () => {
          setIsSaving(true);
          await fetch("/api/save", { method: "POST" });
          setIsSaving(false);
        };
        return isSaving ? <span role="status">Saving</span> : <button onClick={save}>Save</button>;
      };
    `);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a negated state test and an inline handler", () => {
    const result = run(`
      import * as React from "react";
      function Upload() {
        const [pending, setPending] = React.useState(false);
        return <section>{!pending ? (
          <button onClick={async () => {
            setPending(true);
            await fetch("/api/upload", { method: "POST" });
            setPending(false);
          }}>Upload</button>
        ) : <p aria-live="polite">Uploading</p>}</section>;
      }
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a button replaced by null", () => {
    const result = run(`
      import { useState } from "react";
      function DeleteButton() {
        const [pending, setPending] = useState(false);
        async function remove() {
          setPending(true);
          await fetch("/api/item", { method: "DELETE" });
          setPending(false);
        }
        return <div>{pending ? null : <button onClick={remove}>Delete</button>}</div>;
      }
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a submit input with a direct click handler", () => {
    const result = run(`
      import { useState } from "react";
      function Submit() {
        const [pending, setPending] = useState(false);
        async function submit() {
          setPending(true);
          await fetch("/api/submit", { method: "POST" });
          setPending(false);
        }
        return pending ? <span>Submitting</span> : <input type="submit" onClick={submit} />;
      }
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    ["disabled", "disabled={false}"],
    ["aria-disabled", 'aria-disabled="false"'],
  ])("flags an action whose static %s value proves it is enabled", (_description, attribute) => {
    const result = run(`
      import { useState } from "react";
      function Save() {
        const [pending, setPending] = useState(false);
        async function save() {
          setPending(true);
          await fetch("/api/save");
          setPending(false);
        }
        return pending ? <span>Saving</span> : <button ${attribute} onClick={save}>Save</button>;
      }
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an explicit type=button action inside a form", () => {
    const result = run(`
      import { useState } from "react";
      function Save() {
        const [pending, setPending] = useState(false);
        async function save() {
          setPending(true);
          await fetch("/api/save");
          setPending(false);
        }
        return <form>{pending ? <span>Saving</span> : <button type="button" onClick={save}>Save</button>}</form>;
      }
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("uses the first valid fallback role when proving passive status content", () => {
    const result = run(`
      import { useState } from "react";
      function Save() {
        const [pending, setPending] = useState(false);
        async function save() {
          setPending(true);
          await fetch("/api/save");
          setPending(false);
        }
        return pending ? <span role="unsupported status">Saving</span> : <button onClick={save}>Save</button>;
      }
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    ["an as expression", `true as boolean`],
    ["a satisfies expression", `true satisfies boolean`],
    ["a non-null expression", `true!`],
    ["nested transparent wrappers", `((true as const) satisfies boolean)!`],
  ])("flags when the pending setter receives %s", (_description, setterValue) => {
    const result = run(`
      import { useState } from "react";
      function Save() {
        const [pending, setPending] = useState(false);
        async function save() {
          setPending(${setterValue});
          await fetch("/api/save");
          setPending(false);
        }
        return pending ? <span>Saving</span> : <button onClick={save}>Save</button>;
      }
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet when the same button root is preserved", () => {
    const result = run(`
      import { useState } from "react";
      const Save = () => {
        const [pending, setPending] = useState(false);
        const save = async () => {
          setPending(true);
          await fetch("/api/save");
          setPending(false);
        };
        return pending
          ? <button disabled>Saving</button>
          : <button onClick={save}>Save</button>;
      };
    `);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when the action remains mounted and changes its contents", () => {
    const result = run(`
      import { useState } from "react";
      const Save = () => {
        const [pending, setPending] = useState(false);
        const save = async () => {
          setPending(true);
          await fetch("/api/save");
          setPending(false);
        };
        return <button onClick={save} disabled={pending}>{pending ? "Saving" : "Save"}</button>;
      };
    `);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for an opaque pending component", () => {
    const result = run(`
      import { useState } from "react";
      const Save = () => {
        const [pending, setPending] = useState(false);
        async function save() {
          setPending(true);
          await fetch("/api/save");
          setPending(false);
        }
        return pending ? <Spinner /> : <button onClick={save}>Save</button>;
      };
    `);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when passive-looking content contains an opaque child", () => {
    const result = run(`
      import { useState } from "react";
      const Save = () => {
        const [pending, setPending] = useState(false);
        async function save() {
          setPending(true);
          await fetch("/api/save");
          setPending(false);
        }
        return pending ? <span><Status /></span> : <button onClick={save}>Save</button>;
      };
    `);
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    ["an interactive descendant", `<span><a href="/help">Help</a></span>`],
    ["an event handler", `<span onClick={() => retry()}>Retrying</span>`],
    ["an interactive role", `<span role="button">Retrying</span>`],
    ["a focus target", `<span tabIndex={-1}>Saving</span>`],
    ["a spread", `<span {...statusProps}>Saving</span>`],
    ["dynamic children", `<span>{pendingContent}</span>`],
    ["an iframe", `<iframe title="Saving" />`],
    ["a label", `<label htmlFor="save">Saving</label>`],
    ["an htmlFor relationship", `<div htmlFor="save">Saving</div>`],
    ["inline HTML", `<div dangerouslySetInnerHTML={{ __html: statusHtml }} />`],
    ["a ref", `<div ref={statusRef}>Saving</div>`],
    ["an invalid role fallback", `<span role="unsupported">Saving</span>`],
    ["an interactive fallback role", `<span role="unsupported button">Saving</span>`],
  ])("stays quiet when the pending branch has %s", (_description, pendingBranch) => {
    const result = run(`
      import { useState } from "react";
      const Save = () => {
        const [pending, setPending] = useState(false);
        async function save() {
          setPending(true);
          await fetch("/api/save");
          setPending(false);
        }
        return pending ? ${pendingBranch} : <button onClick={save}>Save</button>;
      };
    `);
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    ["a prop", `const Save = ({ pending }) => { const setPending = () => {};`],
    ["a custom hook", `const Save = () => { const [pending, setPending] = usePending();`],
    [
      "useReducer",
      `const Save = () => { const [pending, setPending] = useReducer(reducer, false);`,
    ],
    [
      "a query result",
      `const Save = () => { const { isPending: pending, mutateAsync: setPending } = useMutation();`,
    ],
  ])("stays quiet when pending comes from %s", (_description, componentStart) => {
    const result = run(`
      import { useState } from "react";
      ${componentStart}
        async function save() {
          setPending(true);
          await fetch("/api/save");
        }
        return pending ? <span>Saving</span> : <button onClick={save}>Save</button>;
      };
    `);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for an unproven global useState", () => {
    const result = run(`
      const Save = () => {
        const [pending, setPending] = useState(false);
        async function save() {
          setPending(true);
          await fetch("/api/save");
        }
        return pending ? <span>Saving</span> : <button onClick={save}>Save</button>;
      };
    `);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for a locally shadowed useState", () => {
    const result = run(`
      const useState = (value) => [value, () => {}];
      const Save = () => {
        const [pending, setPending] = useState(false);
        async function save() {
          setPending(true);
          await fetch("/api/save");
        }
        return pending ? <span>Saving</span> : <button onClick={save}>Save</button>;
      };
    `);
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    ["true initial state", `useState(true)`],
    ["lazy initial state", `useState(() => false)`],
    ["an extra tuple element", `useState(false)`],
  ])("stays quiet for %s", (description, initializer) => {
    const tuple =
      description === "an extra tuple element"
        ? `[pending, setPending, metadata]`
        : `[pending, setPending]`;
    const result = run(`
      import { useState } from "react";
      const Save = () => {
        const ${tuple} = ${initializer};
        async function save() {
          setPending(true);
          await fetch("/api/save");
        }
        return pending ? <span>Saving</span> : <button onClick={save}>Save</button>;
      };
    `);
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    ["a compound guard", `pending && enabled`],
    ["an aliased guard", `isBusy`],
  ])("stays quiet for %s", (_description, test) => {
    const result = run(`
      import { useState } from "react";
      const Save = () => {
        const [pending, setPending] = useState(false);
        const isBusy = pending;
        async function save() {
          setPending(true);
          await fetch("/api/save");
        }
        return ${test} ? <span>Saving</span> : <button onClick={save}>Save</button>;
      };
    `);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when multiple rendered actions consume the same state", () => {
    const result = run(`
      import { useState } from "react";
      const Save = () => {
        const [pending, setPending] = useState(false);
        async function save() {
          setPending(true);
          await fetch("/api/save");
        }
        return <>
          {pending ? <span>Saving</span> : <button onClick={save}>Save</button>}
          {pending ? <span>Saving copy</span> : <button onClick={save}>Save copy</button>}
        </>;
      };
    `);
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    ["sets pending after the suspension", `await fetch("/api/save"); setPending(true);`],
    ["does not await", `setPending(true); return fetch("/api/save");`],
    ["uses promise then", `setPending(true); fetch("/api/save").then(done);`],
    ["awaits opaque work", `setPending(true); await saveRequest();`],
    ["has an unreachable fetch suspension", `setPending(true); return; await fetch("/api/save");`],
    ["sets pending conditionally", `if (enabled) setPending(true); await fetch("/api/save");`],
    [
      "resets pending before the suspension",
      `setPending(true); setPending(false); await fetch("/api/save");`,
    ],
    [
      "resets pending through transparent wrappers before the suspension",
      `setPending(true as boolean); setPending(false satisfies boolean); await fetch("/api/save");`,
    ],
  ])("stays quiet when the handler %s", (_description, body) => {
    const result = run(`
      import { useState } from "react";
      const Save = () => {
        const [pending, setPending] = useState(false);
        async function save() { ${body} }
        return pending ? <span>Saving</span> : <button onClick={save}>Save</button>;
      };
    `);
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    ["moves focus", `inputRef.current.focus()`],
    ["navigates", `navigate("/done")`],
    ["uses a router", `router.push("/done")`],
    ["uses a receiver navigation method", `router.navigate("/done")`],
    ["assigns a location href", `window.location.href = "/done"`],
    ["assigns window.location", `window.location = "/done"`],
    ["requests a form submission", `formRef.current.requestSubmit()`],
    ["submits a form", `formRef.current.submit()`],
  ])("stays quiet when the handler intentionally %s", (_description, transfer) => {
    const result = run(`
      import { useState } from "react";
      const Save = () => {
        const [pending, setPending] = useState(false);
        async function save() {
          setPending(true);
          await fetch("/api/save");
          ${transfer};
          setPending(false);
        }
        return pending ? <span>Saving</span> : <button onClick={save}>Save</button>;
      };
    `);
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    [
      "a custom action",
      `<Button onClick={save}>Save</Button>`,
      `import { useState } from "react";`,
      `async function save() { setPending(true); await fetch("/api/save"); }`,
    ],
    [
      "an action spread",
      `<button {...buttonProps} onClick={save}>Save</button>`,
      `import { useState } from "react";`,
      `async function save() { setPending(true); await fetch("/api/save"); }`,
    ],
    [
      "an imported handler",
      `<button onClick={save}>Save</button>`,
      `import { save } from "./actions";`,
      "",
    ],
    [
      "a useCallback handler",
      `<button onClick={save}>Save</button>`,
      `import { useCallback, useState } from "react";`,
      `const save = useCallback(async () => { setPending(true); await fetch("/api/save"); }, []);`,
    ],
  ])("stays quiet for %s", (_description, action, imports, handler) => {
    const result = run(`
      ${imports}
      const Save = () => {
        const [pending, setPending] = useState(false);
        ${handler}
        return pending ? <span>Saving</span> : ${action};
      };
    `);
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    [
      "an implicit button with a literal owner",
      `<button form="save-form" onClick={save}>Save</button>`,
    ],
    [
      "a submit button with a dynamic owner",
      `<button type="submit" form={formId} onClick={save}>Save</button>`,
    ],
    [
      "a submit input with a literal owner",
      `<input type="submit" form="save-form" onClick={save} />`,
    ],
    ["an image input with a dynamic owner", `<input type="image" form={formId} onClick={save} />`],
  ])("stays quiet for %s outside form ancestry", (_description, action) => {
    const result = run(`
      import { useState } from "react";
      function Save() {
        const [pending, setPending] = useState(false);
        async function save() {
          setPending(true);
          await fetch("/api/save", { method: "POST" });
          setPending(false);
        }
        return pending ? <span>Saving</span> : ${action};
      }
    `);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a type=button with a form owner attribute", () => {
    const result = run(`
      import { useState } from "react";
      function Save() {
        const [pending, setPending] = useState(false);
        async function save() {
          setPending(true);
          await fetch("/api/save");
          setPending(false);
        }
        return pending ? <span>Saving</span> : <button type="button" form="save-form" onClick={save}>Save</button>;
      }
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet when the handler escapes", () => {
    const result = run(`
      import { useState } from "react";
      const Save = () => {
        const [pending, setPending] = useState(false);
        async function save() {
          setPending(true);
          await fetch("/api/save");
        }
        registerSave(save);
        return pending ? <span>Saving</span> : <button onClick={save}>Save</button>;
      };
    `);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when the setter escapes", () => {
    const result = run(`
      import { useState } from "react";
      const Save = () => {
        const [pending, setPending] = useState(false);
        async function save() {
          setPending(true);
          await fetch("/api/save");
        }
        registerSetter(setPending);
        return pending ? <span>Saving</span> : <button onClick={save}>Save</button>;
      };
    `);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for a shadowed fetch implementation", () => {
    const result = run(`
      import { useState } from "react";
      const fetch = async () => navigate("/next");
      const Save = () => {
        const [pending, setPending] = useState(false);
        async function save() {
          setPending(true);
          await fetch();
        }
        return pending ? <span>Saving</span> : <button onClick={save}>Save</button>;
      };
    `);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when the action relies on an ancestor form submit", () => {
    const result = run(`
      import { useState } from "react";
      const Save = () => {
        const [pending, setPending] = useState(false);
        async function save(event) {
          event.preventDefault();
          setPending(true);
          await fetch("/api/save", { method: "POST" });
        }
        return <form onSubmit={save}>{pending ? <span>Saving</span> : <button type="submit">Save</button>}</form>;
      };
    `);
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    ["an implicit submit button", `<button onClick={save}>Save</button>`],
    ["an explicit submit button", `<button type="submit" onClick={save}>Save</button>`],
    ["a dynamic button type", `<button type={buttonType} onClick={save}>Save</button>`],
    ["an empty button type", `<button type="" onClick={save}>Save</button>`],
    ["an invalid button type", `<button type="wat" onClick={save}>Save</button>`],
    ["a submit input", `<input type="submit" onClick={save} />`],
  ])("stays quiet for %s inside a form", (_description, action) => {
    const result = run(`
      import { useState } from "react";
      function Save() {
        const [pending, setPending] = useState(false);
        async function save() {
          setPending(true);
          await fetch("/api/save", { method: "POST" });
          setPending(false);
        }
        return <form>{pending ? <span>Saving</span> : ${action}}</form>;
      }
    `);
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    ["an implicit button", `<button onClick={save}>Save</button>`],
    ["an explicit submit button", `<button type="submit" onClick={save}>Save</button>`],
    ["an empty button type", `<button type="" onClick={save}>Save</button>`],
    ["an invalid button type", `<button type="wat" onClick={save}>Save</button>`],
    ["a submit input", `<input type="submit" onClick={save} />`],
  ])("stays quiet for %s under an opaque custom ancestor", (_description, action) => {
    const result = run(`
      import { useState } from "react";
      function Save() {
        const [pending, setPending] = useState(false);
        async function save() {
          setPending(true);
          await fetch("/api/save", { method: "POST" });
          setPending(false);
        }
        return <Form>{pending ? <span>Saving</span> : ${action}}</Form>;
      }
    `);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a type=button action under an opaque custom ancestor", () => {
    const result = run(`
      import { useState } from "react";
      function Save() {
        const [pending, setPending] = useState(false);
        async function save() {
          setPending(true);
          await fetch("/api/save");
          setPending(false);
        }
        return <Form>{pending ? <span>Saving</span> : <button type="button" onClick={save}>Save</button>}</Form>;
      }
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    ["a dynamic disabled value", `disabled={isDisabled}`],
    ["a dynamic aria-disabled value", `aria-disabled={isDisabled}`],
    ["a statically disabled action", `disabled`],
    ["a statically aria-disabled action", `aria-disabled="true"`],
  ])("stays quiet for %s", (_description, attribute) => {
    const result = run(`
      import { useState } from "react";
      function Save() {
        const [pending, setPending] = useState(false);
        async function save() {
          setPending(true);
          await fetch("/api/save");
          setPending(false);
        }
        return pending ? <span>Saving</span> : <button ${attribute} onClick={save}>Save</button>;
      }
    `);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for route and Suspense loading states", () => {
    const result = run(`
      import { Suspense, useState } from "react";
      const Route = () => {
        const [pending, setPending] = useState(false);
        async function load() {
          setPending(true);
          await fetch("/api/route");
        }
        return <Suspense fallback={<Spinner />}>
          {pending ? <RoutePending /> : <button onClick={load}>Open</button>}
        </Suspense>;
      };
    `);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when the ternary is stored instead of directly rendered", () => {
    const result = run(`
      import { useState } from "react";
      const Save = () => {
        const [pending, setPending] = useState(false);
        async function save() {
          setPending(true);
          await fetch("/api/save");
        }
        const content = pending ? <span>Saving</span> : <button onClick={save}>Save</button>;
        return content;
      };
    `);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when the ternary runs inside a repeated render callback", () => {
    const result = run(`
      import { useState } from "react";
      const List = ({ items }) => {
        const [pending, setPending] = useState(false);
        async function save() {
          setPending(true);
          await fetch("/api/save");
        }
        return <div>{items.map(() => pending ? <span>Saving</span> : <button onClick={save}>Save</button>)}</div>;
      };
    `);
    expect(result.diagnostics).toHaveLength(0);
  });
});
