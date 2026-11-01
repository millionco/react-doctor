import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noNonresizableTextarea } from "./no-nonresizable-textarea.js";

describe("no-nonresizable-textarea", () => {
  it("reports static class and inline resize suppression", () => {
    const result = runRule(
      noNonresizableTextarea,
      `const Editor = () => <><textarea className="resize-none" /><textarea style={{ resize: "none" }} /></>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("allows vertical, block, and responsive-only policies", () => {
    const result = runRule(
      noNonresizableTextarea,
      `const Editor = () => <><textarea className="resize-y" /><textarea style={{ resize: "block" }} /><textarea className="md:resize-none resize-y" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows content-sized textareas", () => {
    const result = runRule(
      noNonresizableTextarea,
      `const Editor = () => <><textarea className="resize-none field-sizing-content" /><textarea style={{ resize: "none", fieldSizing: "content" }} /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("skips custom, dynamic, and spread-owned controls", () => {
    const result = runRule(
      noNonresizableTextarea,
      `const Editor = ({ className, props }) => <><Textarea className="resize-none" /><textarea className={className} /><textarea className="resize-none" {...props} /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows an owned editing handler that grows its own empty controlled field", () => {
    const result = runRule(
      noNonresizableTextarea,
      `import React, { useRef, useState, useCallback, memo } from "react";
      const Draft = memo(() => {
        const [draft, setDraft] = useState("");
        const field = useRef(null);
        const edit = useCallback((event) => {
          setDraft(event.target.value);
          if (field.current) {
            field.current.style.height = "auto";
            field.current.style.height = field.current.scrollHeight + "px";
          }
        }, []);
        const clear = () => {
          setDraft("");
          if (field.current) field.current.style.height = "auto";
        };
        return <form><div><textarea ref={field} value={draft} onChange={edit} className="resize-none" /></div></form>;
      });`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    ["missing growth", `field.current.style.height = "auto";`],
    ["missing reset", `field.current.style.height = field.current.scrollHeight + "px";`],
    ["fixed height", `field.current.style.height = "80px";`],
    [
      "other element measurement",
      `field.current.style.height = "auto"; field.current.style.height = other.current.scrollHeight + "px";`,
    ],
    [
      "conditional growth",
      `field.current.style.height = "auto"; if (enabled) field.current.style.height = field.current.scrollHeight + "px";`,
    ],
    [
      "scheduled growth",
      `queueMicrotask(() => { field.current.style.height = "auto"; field.current.style.height = field.current.scrollHeight + "px"; });`,
    ],
    [
      "overwritten growth",
      `field.current.style.height = "auto"; field.current.style.height = field.current.scrollHeight + "px"; field.current.style.height = "80px";`,
    ],
    [
      "early exit",
      `if (enabled) return; field.current.style.height = "auto"; field.current.style.height = field.current.scrollHeight + "px";`,
    ],
  ])("keeps reporting %s", (_description, body) => {
    const result = runRule(
      noNonresizableTextarea,
      `import { useRef, useState } from "react";
      const Draft = () => {
        const [draft, setDraft] = useState("");
        const field = useRef(null);
        const other = useRef(null);
        const edit = (event) => {
          setDraft(event.target.value);
          if (field.current) { ${body} }
        };
        return <textarea ref={field} value={draft} onChange={edit} className="resize-none" />;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps reporting border-box growth that omits border height", () => {
    const result = runRule(
      noNonresizableTextarea,
      `import { useRef, useState } from "react";
      const NoteInput = () => {
        const [note, setNote] = useState("");
        const input = useRef(null);
        const edit = (event) => {
          setNote(event.currentTarget.value);
          if (input.current) {
            input.current.style.height = "auto";
            input.current.style.height = input.current.scrollHeight + "px";
          }
        };
        return <textarea ref={input} value={note} onChange={edit}
          style={{ resize: "none", boxSizing: "border-box", border: "20px solid", padding: 0, overflow: "hidden" }} />;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    ["legacy sizing", `style={{ resize: "none" }}`, "", 0],
    [
      "literal content-box with borders",
      `style={{ resize: "none", boxSizing: "content-box", border: "20px solid", padding: 0, overflow: "hidden" }}`,
      "",
      0,
    ],
    ["case-insensitive content-box", `style={{ resize: "none", boxSizing: "CONTENT-BOX" }}`, "", 0],
    ["unknown inline sizing", `style={{ resize: "none", boxSizing: sizing }}`, "", 1],
    ["explicit border-box", `style={{ resize: "none", boxSizing: "border-box" }}`, "", 1],
    ["explicit inherit", `style={{ resize: "none", boxSizing: "inherit" }}`, "", 1],
    ["explicit unset", `style={{ resize: "none", boxSizing: "unset" }}`, "", 1],
    ["box-border class", `className="resize-none box-border"`, "", 1],
    ["important box-border class", `className="resize-none !box-border"`, "", 1],
    ["trailing important class", `className="resize-none box-border!"`, "", 1],
    ["responsive box-border class", `className="resize-none md:box-border"`, "", 1],
    ["responsive important class", `className="resize-none md:!box-border"`, "", 1],
    ["responsive trailing important class", `className="resize-none md:box-border!"`, "", 1],
    ["arbitrary border-box", `className="resize-none [box-sizing:border-box]"`, "", 1],
    [
      "case-insensitive arbitrary property",
      `className="resize-none [BOX-SIZING:border-box]"`,
      "",
      1,
    ],
    [
      "responsive arbitrary border-box",
      `className="resize-none md:[box-sizing:border-box]"`,
      "",
      1,
    ],
    ["important arbitrary border-box", `className="resize-none ![box-sizing:border-box]"`, "", 1],
    ["unknown arbitrary sizing", `className="resize-none [box-sizing:var(--sizing)]"`, "", 1],
    ["box-content class", `className="resize-none box-content"`, "", 0],
    ["arbitrary content-box", `className="resize-none [box-sizing:content-box]"`, "", 0],
    [
      "responsive arbitrary content-box",
      `className="resize-none md:![box-sizing:content-box]"`,
      "",
      0,
    ],
    [
      "ancestor-only border-box",
      `style={{ resize: "none" }}`,
      `style={{ boxSizing: "border-box" }}`,
      0,
    ],
    [
      "ancestor-only unknown sizing",
      `style={{ resize: "none" }}`,
      `style={{ boxSizing: sizing }}`,
      0,
    ],
    ["ancestor-only box-border class", `className="resize-none"`, `className="md:!box-border"`, 0],
  ])(
    "preserves the %s box-model boundary",
    (_description, attributes, ancestorAttributes, expectedDiagnosticCount) => {
      const result = runRule(
        noNonresizableTextarea,
        `import { useRef, useState } from "react";
      const NoteInput = () => {
        const [note, setNote] = useState("");
        const input = useRef(null);
        const edit = (event) => {
          setNote(event.currentTarget.value);
          if (input.current) {
            input.current.style.height = "auto";
            input.current.style.height = input.current.scrollHeight + "px";
          }
        };
        return <div ${ancestorAttributes}><textarea ref={input} value={note} onChange={edit} ${attributes} /></div>;
      };`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(expectedDiagnosticCount);
    },
  );

  it.each([
    ["fixed height", `className="resize-none h-20"`, ""],
    ["maximum height", `className="resize-none md:max-h-40"`, ""],
    ["inline ceiling", `className="resize-none" style={{ maxHeight: 160 }}`, ""],
    ["dynamic style", `className="resize-none" style={theme}`, ""],
    ["dynamic class", `className={theme} style={{ resize: "none" }}`, ""],
    ["overridden editing handler", `className="resize-none" onChange={externalEdit}`, ""],
    ["overridden ref", `className="resize-none" ref={externalRef}`, ""],
    ["keyed remount", `className="resize-none" key={recordId}`, ""],
    ["other editing handler", `className="resize-none" onInput={alterHeight}`, ""],
    [
      "controlled external update",
      `className="resize-none"`,
      `const replace = () => setDraft(externalText);`,
    ],
    ["escaped setter", `className="resize-none"`, `observe(setDraft);`],
    ["escaped ref", `className="resize-none"`, `observe(field);`],
    ["shared ref", `className="resize-none"`, `const preview = <div ref={field} />;`],
    ["shared handler", `className="resize-none"`, `const preview = <input onChange={edit} />;`],
    [
      "external height overwrite",
      `className="resize-none"`,
      `const shrink = () => { field.current.style.height = "40px"; };`,
    ],
    [
      "unpaired height reset",
      `className="resize-none"`,
      `const shrink = () => { field.current.style.height = "auto"; };`,
    ],
    [
      "delayed reset",
      `className="resize-none"`,
      `const clear = async () => { setDraft(""); await finish(); if (field.current) field.current.style.height = "auto"; };`,
    ],
  ])("keeps reporting %s ownership boundaries", (_description, attributes, extra) => {
    const result = runRule(
      noNonresizableTextarea,
      `import { useRef, useState } from "react";
      const Draft = () => {
        const [draft, setDraft] = useState("");
        const field = useRef(null);
        const edit = (event) => {
          setDraft(event.currentTarget.value);
          if (field.current) {
            field.current.style.height = "auto";
            field.current.style.height = field.current.scrollHeight + "px";
          }
        };
        ${extra}
        return <textarea ref={field} value={draft} onChange={edit} ${attributes} />;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it.each(["react", "custom-hooks"])("binds ref and state hooks to %s", (provider) => {
    const pixelExpression = "`" + "${field.current.scrollHeight}px" + "`";
    const result = runRule(
      noNonresizableTextarea,
      `
      import { useRef as createRef, useState as createState } from "${provider}";
      const Draft = () => {
        const [draft, setDraft] = createState("");
        const field = createRef(null);
        const edit = (event) => {
          setDraft(event.currentTarget.value);
          if (field.current) {
            field.current.style.height = "auto";
            field.current.style.height = ${pixelExpression};
          }
        };
        return <textarea ref={field} value={draft} onChange={edit} style={{ resize: "none" }} />;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(provider === "react" ? 0 : 1);
  });

  it.each([
    ["type-only declaration", `import type { useRef, useState, useCallback } from "react";`],
    ["type-only specifier", `import { type useRef, useState, useCallback } from "react";`],
    ["type-only state", `import { useRef, type useState, useCallback } from "react";`],
    ["type-only callback", `import { useRef, useState, type useCallback } from "react";`],
    ["different runtime", `import { useRef, useState, useCallback } from "preact/hooks";`],
    ["DOM provider", `import { useRef, useState, useCallback } from "react-dom";`],
    [
      "shadowed ref",
      `import { useState, useCallback } from "react"; const useRef = () => ({ get current() { return unrelated; } });`,
    ],
  ])("keeps reporting unsupported %s provenance", (_description, imports) => {
    const result = runRule(
      noNonresizableTextarea,
      `${imports}
      const Draft = () => {
        const [draft, setDraft] = useState("");
        const field = useRef(null);
        const edit = useCallback((event) => {
          setDraft(event.currentTarget.value);
          if (field.current) {
            field.current.style.height = "auto";
            field.current.style.height = field.current.scrollHeight + "px";
          }
        }, []);
        return <textarea ref={field} value={draft} onChange={edit} className="resize-none" />;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps reporting replaced namespace callbacks", () => {
    const result = runRule(
      noNonresizableTextarea,
      `import React, { useState, useRef } from "react";
      React.useCallback = () => () => {};
      const Draft = () => {
        const [draft, setDraft] = useState("");
        const field = useRef(null);
        const edit = React.useCallback((event) => {
          setDraft(event.currentTarget.value);
          if (field.current) {
            field.current.style.height = "auto";
            field.current.style.height = field.current.scrollHeight + "px";
          }
        }, []);
        return <textarea ref={field} value={draft} onChange={edit} className="resize-none" />;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    [
      "conditional mount",
      "visible ?",
      '<textarea ref={field} value={draft} onChange={edit} className="resize-none" /> : null',
    ],
    [
      "alternative return",
      "",
      '<textarea ref={field} value={draft} onChange={edit} className="resize-none" />',
      "if (!visible) return null;",
    ],
    [
      "keyed native ancestor",
      "",
      '<div key={recordId}><textarea ref={field} value={draft} onChange={edit} className="resize-none" /></div>',
    ],
    [
      "opaque wrapper",
      "",
      '<Boundary><textarea ref={field} value={draft} onChange={edit} className="resize-none" /></Boundary>',
    ],
    [
      "ancestor ref callback",
      "",
      '<div ref={(element) => { element.querySelector("textarea").style.height = "20px"; }}><textarea ref={field} value={draft} onChange={edit} className="resize-none" /></div>',
    ],
    [
      "editable ancestor",
      "",
      '<div contentEditable><textarea ref={field} value={draft} onChange={edit} className="resize-none" /></div>',
    ],
    [
      "provider alias write",
      "",
      '<textarea ref={field} value={draft} onChange={edit} className="resize-none" />',
      "React.useCallback = replacement;",
    ],
  ])("keeps reporting %s lifetime boundaries", (_description, prefix, output, extra = "") => {
    const result = runRule(
      noNonresizableTextarea,
      `import React, { useState, useRef, useCallback } from "react";
      const Draft = () => {
        const [draft, setDraft] = useState("");
        const field = useRef(null);
        const edit = useCallback((event) => {
          setDraft(event.currentTarget.value);
          if (field.current) {
            field.current.style.height = "auto";
            field.current.style.height = field.current.scrollHeight + "px";
          }
        }, []);
        ${extra}
        return ${prefix} ${output};
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
