import { describe, expect, it } from "vite-plus/test";

import { collectRuleHits, createScopedTempRoot, setupReactProject } from "./_helpers.js";

const tempRoot = createScopedTempRoot("no-uncontrolled-input");

describe("no-uncontrolled-input", () => {
  it("flags `value` without onChange / readOnly", async () => {
    const projectDir = setupReactProject(tempRoot, "no-uncontrolled-input-no-onchange", {
      files: {
        "src/Form.tsx": `export const Form = () => <input value="frozen" />;
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-uncontrolled-input");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("silently read-only");
  });

  it("flags `value` + `defaultValue` set together", async () => {
    const projectDir = setupReactProject(tempRoot, "no-uncontrolled-input-both", {
      files: {
        "src/Form.tsx": `import { useState } from "react";

export const Form = () => {
  const [name, setName] = useState("");
  return (
    <input
      value={name}
      defaultValue="hello"
      onChange={(event) => setName(event.target.value)}
    />
  );
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-uncontrolled-input");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("defaultValue");
  });

  it("flags useState() with no initial value used as `value`", async () => {
    const projectDir = setupReactProject(tempRoot, "no-uncontrolled-input-flip", {
      files: {
        "src/Form.tsx": `import { useState } from "react";

export const Form = () => {
  const [name, setName] = useState();
  return <input value={name} onChange={(event) => setName(event.target.value)} />;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-uncontrolled-input");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("uncontrolled");
  });

  it("does not flag <input type='checkbox' value='cat'> (value is a form token)", async () => {
    const projectDir = setupReactProject(tempRoot, "no-uncontrolled-input-checkbox", {
      files: {
        "src/Form.tsx": `export const Form = () => <input type="checkbox" value="cat" />;
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-uncontrolled-input");
    expect(hits).toHaveLength(0);
  });

  it("does not flag inputs with spread props (onChange may come from spread)", async () => {
    const projectDir = setupReactProject(tempRoot, "no-uncontrolled-input-spread", {
      files: {
        "src/Form.tsx": `import { useState } from "react";

export const Form = ({ inputProps }: { inputProps: object }) => {
  const [name, setName] = useState("");
  void setName;
  return (
    <>
      <input value={name} {...inputProps} />
      <input {...inputProps} value={name} />
    </>
  );
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-uncontrolled-input");
    expect(hits).toHaveLength(0);
  });
});
