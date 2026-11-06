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
        return <form><div><textarea ref={field} value={draft} onChange={edit} className="resize-none box-content" /></div></form>;
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
        return <textarea ref={field} value={draft} onChange={edit} className="resize-none box-content" />;
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
    ["unknown sizing", `style={{ resize: "none" }}`, "", 1],
    ["externally styled field", `className="resize-none app-field"`, "", 1],
    [
      "literal content-box with borders",
      `style={{ resize: "none", boxSizing: "content-box", border: "20px solid", padding: 0, overflow: "hidden" }}`,
      "",
      0,
    ],
    [
      "later inline all reset",
      `className="resize-none" style={{ boxSizing: "content-box", all: "inherit" }}`,
      `style={{ boxSizing: "border-box" }}`,
      1,
    ],
    [
      "earlier literal all reset",
      `className="resize-none" style={{ all: "inherit", boxSizing: "content-box" }}`,
      `style={{ boxSizing: "border-box" }}`,
      0,
    ],
    [
      "inline all reset that may be introduced on a later render",
      `className="resize-none" style={{ all: reset, boxSizing: "content-box" }}`,
      `style={{ boxSizing: "border-box" }}`,
      1,
    ],
    [
      "important all class reset",
      `className="resize-none md:[all:inherit]!" style={{ boxSizing: "content-box" }}`,
      `style={{ boxSizing: "border-box" }}`,
      1,
    ],
    [
      "arbitrary all class reset",
      `className="resize-none box-content [all:inherit]"`,
      `style={{ boxSizing: "border-box" }}`,
      1,
    ],
    [
      "ancestor arbitrary direct-child reset",
      `style={{ resize: "none", boxSizing: "content-box" }}`,
      `className="[&>textarea]:[all:inherit]!" style={{ boxSizing: "border-box" }}`,
      1,
    ],
    [
      "ancestor child utility overrides inline sizing",
      `style={{ resize: "none", boxSizing: "content-box" }}`,
      `className="*:box-border!"`,
      1,
    ],
    [
      "ancestor selector targets a different element",
      `style={{ resize: "none", boxSizing: "content-box" }}`,
      `className="[&>button]:[all:inherit]!"`,
      0,
    ],
    [
      "overwritten dynamic inline sizing may still run",
      `className="resize-none" style={{ boxSizing: mutateSizing(), ["boxSizing"]: "content-box" }}`,
      "",
      1,
    ],
    [
      "stacked descendant utility cannot target a direct child",
      `style={{ resize: "none", boxSizing: "content-box" }}`,
      `className="**:*:[all:inherit]!"`,
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
      1,
    ],
    [
      "ancestor-only border-box",
      `style={{ resize: "none", boxSizing: "content-box" }}`,
      `style={{ boxSizing: "border-box" }}`,
      0,
    ],
    [
      "ancestor-only unknown sizing",
      `style={{ resize: "none", boxSizing: "content-box" }}`,
      `style={{ boxSizing: sizing }}`,
      0,
    ],
    [
      "ancestor-only box-border class",
      `className="resize-none box-content"`,
      `className="md:!box-border"`,
      0,
    ],
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
    ["fixed height", `className="resize-none box-content h-20"`, ""],
    ["maximum height", `className="resize-none box-content md:max-h-40"`, ""],
    ["inline ceiling", `className="resize-none box-content" style={{ maxHeight: 160 }}`, ""],
    ["dynamic style", `className="resize-none box-content" style={theme}`, ""],
    ["dynamic class", `className={theme} style={{ resize: "none", boxSizing: "content-box" }}`, ""],
    [
      "overridden editing handler",
      `className="resize-none box-content" onChange={externalEdit}`,
      "",
    ],
    ["overridden ref", `className="resize-none box-content" ref={externalRef}`, ""],
    ["keyed remount", `className="resize-none box-content" key={recordId}`, ""],
    ["other editing handler", `className="resize-none box-content" onInput={alterHeight}`, ""],
    [
      "controlled external update",
      `className="resize-none box-content"`,
      `const replace = () => setDraft(externalText);`,
    ],
    ["escaped setter", `className="resize-none box-content"`, `observe(setDraft);`],
    ["escaped ref", `className="resize-none box-content"`, `observe(field);`],
    ["shared ref", `className="resize-none box-content"`, `const preview = <div ref={field} />;`],
    [
      "shared handler",
      `className="resize-none box-content"`,
      `const preview = <input onChange={edit} />;`,
    ],
    [
      "external height overwrite",
      `className="resize-none box-content"`,
      `const shrink = () => { field.current.style.height = "40px"; };`,
    ],
    [
      "unpaired height reset",
      `className="resize-none box-content"`,
      `const shrink = () => { field.current.style.height = "auto"; };`,
    ],
    [
      "delayed reset",
      `className="resize-none box-content"`,
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
        return <textarea ref={field} value={draft} onChange={edit} style={{ resize: "none", boxSizing: "content-box" }} />;
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
        return <textarea ref={field} value={draft} onChange={edit} className="resize-none box-content" />;
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
        return <textarea ref={field} value={draft} onChange={edit} className="resize-none box-content" />;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    [
      "conditional mount",
      "visible ?",
      '<textarea ref={field} value={draft} onChange={edit} className="resize-none box-content" /> : null',
    ],
    [
      "alternative return",
      "",
      '<textarea ref={field} value={draft} onChange={edit} className="resize-none box-content" />',
      "if (!visible) return null;",
    ],
    [
      "keyed native ancestor",
      "",
      '<div key={recordId}><textarea ref={field} value={draft} onChange={edit} className="resize-none box-content" /></div>',
    ],
    [
      "opaque wrapper",
      "",
      '<Boundary><textarea ref={field} value={draft} onChange={edit} className="resize-none box-content" /></Boundary>',
    ],
    [
      "ancestor ref callback",
      "",
      '<div ref={(element) => { element.querySelector("textarea").style.height = "20px"; }}><textarea ref={field} value={draft} onChange={edit} className="resize-none box-content" /></div>',
    ],
    [
      "editable ancestor",
      "",
      '<div contentEditable><textarea ref={field} value={draft} onChange={edit} className="resize-none box-content" /></div>',
    ],
    [
      "stacked descendant utility overrides a nested textarea",
      "",
      '<div className="**:*:[all:inherit]!"><section><textarea ref={field} value={draft} onChange={edit} className="resize-none box-content" /></section></div>',
    ],
    [
      "provider alias write",
      "",
      '<textarea ref={field} value={draft} onChange={edit} className="resize-none box-content" />',
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
