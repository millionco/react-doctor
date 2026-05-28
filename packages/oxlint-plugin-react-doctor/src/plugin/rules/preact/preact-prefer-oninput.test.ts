import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { preactPreferOninput } from "./preact-prefer-oninput.js";

describe("preact-prefer-oninput", () => {
  it("flags `onChange` on a text input", () => {
    const result = runRule(
      preactPreferOninput,
      `
      import { useState } from "preact/hooks";

      const Search = () => {
        const [query, setQuery] = useState("");
        return <input type="text" value={query} onChange={(e) => setQuery(e.currentTarget.value)} />;
      };
      `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("onInput");
  });

  it("flags `onChange` on a textarea", () => {
    const result = runRule(
      preactPreferOninput,
      `
      import { useState } from "preact/hooks";

      const Comment = () => {
        const [text, setText] = useState("");
        return <textarea value={text} onChange={(e) => setText(e.currentTarget.value)} />;
      };
      `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags `onChange` on an input with no type attribute (defaults to text)", () => {
    const result = runRule(
      preactPreferOninput,
      `
      import { useState } from "preact/hooks";

      const Name = () => {
        const [name, setName] = useState("");
        return <input value={name} onChange={(e) => setName(e.currentTarget.value)} />;
      };
      `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags `onChange` on a password input", () => {
    const result = runRule(
      preactPreferOninput,
      `
      import { useState } from "preact/hooks";

      const Login = () => {
        const [password, setPassword] = useState("");
        return <input type="password" value={password} onChange={(e) => setPassword(e.currentTarget.value)} />;
      };
      `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags `onChange` on an email input", () => {
    const result = runRule(
      preactPreferOninput,
      `
      import { useState } from "preact/hooks";

      const Email = () => {
        const [email, setEmail] = useState("");
        return <input type="email" value={email} onChange={(e) => setEmail(e.currentTarget.value)} />;
      };
      `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag `onChange` on a checkbox", () => {
    const result = runRule(
      preactPreferOninput,
      `
      import { useState } from "preact/hooks";

      const Toggle = () => {
        const [enabled, setEnabled] = useState(false);
        return <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.currentTarget.checked)} />;
      };
      `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag `onChange` on a radio button", () => {
    const result = runRule(
      preactPreferOninput,
      `
      import { useState } from "preact/hooks";

      const Choice = () => {
        const [selected, setSelected] = useState("a");
        return <input type="radio" name="choice" value="a" onChange={() => setSelected("a")} />;
      };
      `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag `onChange` on a file input", () => {
    const result = runRule(
      preactPreferOninput,
      `
      import { useState } from "preact/hooks";

      const Upload = () => {
        return <input type="file" onChange={(e) => console.log(e.target.files)} />;
      };
      `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag `onChange` on a select element", () => {
    const result = runRule(
      preactPreferOninput,
      `
      import { useState } from "preact/hooks";

      const Picker = () => {
        const [color, setColor] = useState("red");
        return (
          <select value={color} onChange={(e) => setColor(e.currentTarget.value)}>
            <option value="red">Red</option>
          </select>
        );
      };
      `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag `onInput` on a text input (already correct)", () => {
    const result = runRule(
      preactPreferOninput,
      `
      import { useState } from "preact/hooks";

      const Search = () => {
        const [query, setQuery] = useState("");
        return <input type="text" value={query} onInput={(e) => setQuery(e.currentTarget.value)} />;
      };
      `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  // Compat-aware gating moved to the project level via the
  // `pure-preact` capability — `preact/compat`'s `onChange` remap is a
  // runtime patch on the Preact renderer (once compat loads anywhere
  // in the project, every file benefits regardless of its own
  // imports). The per-file import-detection tests that used to live
  // here moved to `core/tests/build-capabilities.test.ts` where they
  // belong: when `react` is in deps, `pure-preact` is not emitted,
  // and this rule never runs.

  it("flags `onChange` on a number input", () => {
    const result = runRule(
      preactPreferOninput,
      `
      import { useState } from "preact/hooks";

      const Quantity = () => {
        const [count, setCount] = useState(1);
        return <input type="number" value={count} onChange={(e) => setCount(Number(e.currentTarget.value))} />;
      };
      `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags `onChange` on an input with a dynamic `type` expression (assumes text-like)", () => {
    const result = runRule(
      preactPreferOninput,
      `
      import { useState } from "preact/hooks";

      const DynamicInput = ({ inputType }) => {
        const [value, setValue] = useState("");
        return <input type={inputType} value={value} onChange={(e) => setValue(e.currentTarget.value)} />;
      };
      `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });
});
