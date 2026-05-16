/**
 * Regression tests for `no-prevent-default` framework awareness.
 *
 * Previously the rule fired the same "use a server action for progressive
 * enhancement" message for every `<form onSubmit preventDefault()>`,
 * regardless of whether the project actually shipped a server-action
 * story. In a Vite/CRA/Gatsby/Expo/RN app `preventDefault()` IS the
 * canonical pattern, so the recommendation was actively misleading.
 *
 * New behavior (covered below):
 *
 *   server-capable (`nextjs` / `tanstack-start` / `remix`) →
 *     diagnostic fires with the "server action" wording.
 *   client-only / SPA / mobile (`vite` / `cra` / `gatsby` /
 *     `react-native` / `expo`) → form variant is suppressed entirely.
 *   `unknown` framework → diagnostic still fires with a
 *     framework-neutral message that DOES NOT mention "server action".
 *   `<a onClick preventDefault()>` → unchanged across all frameworks
 *     (it's about UX/accessibility, not server capability).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";

import { runOxlint } from "@react-doctor/core";
import type { Diagnostic, ProjectInfo } from "@react-doctor/types";
import { buildTestProject, setupReactProject } from "./_helpers.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-no-prevent-default-"));
const RULE_ID = "no-prevent-default";

const FORM_PREVENT_DEFAULT_SOURCE = `export const SignUp = () => (
  <form
    onSubmit={(event) => {
      event.preventDefault();
    }}
  >
    <input />
    <button type="submit">Submit</button>
  </form>
);
`;

const ANCHOR_PREVENT_DEFAULT_SOURCE = `export const Pager = () => (
  <a
    href="#"
    onClick={(event) => {
      event.preventDefault();
    }}
  >
    Next
  </a>
);
`;

const DIALOG_FORM_SOURCE = `import { useState } from "react";

export const ConfirmDialog = () => {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        setOpen(false);
      }}
    >
      <button type="submit">OK</button>
    </form>
  );
};
`;

interface GetRuleHitsOptions {
  framework: ProjectInfo["framework"];
}

const getPreventDefaultHits = async (
  projectDir: string,
  options: GetRuleHitsOptions,
): Promise<Diagnostic[]> => {
  const diagnostics = await runOxlint({
    rootDirectory: projectDir,
    project: buildTestProject({
      rootDirectory: projectDir,
      framework: options.framework,
    }),
  });
  return diagnostics.filter((diagnostic) => diagnostic.rule === RULE_ID);
};

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe("no-prevent-default — Vite SPA", () => {
  const createViteProject = (caseId: string, files: Record<string, string>): string =>
    setupReactProject(tempRoot, caseId, {
      packageJsonExtras: {
        dependencies: { react: "^19.0.0", "react-dom": "^19.0.0", vite: "^7.0.0" },
      },
      files,
    });

  it("suppresses the <form> onSubmit warning in a Vite SPA", async () => {
    const projectDir = createViteProject("vite-form", {
      "src/sign-up.tsx": FORM_PREVENT_DEFAULT_SOURCE,
    });

    await expect(getPreventDefaultHits(projectDir, { framework: "vite" })).resolves.toEqual([]);
  });

  it("still flags <a onClick preventDefault()> in a Vite SPA", async () => {
    const projectDir = createViteProject("vite-anchor", {
      "src/pager.tsx": ANCHOR_PREVENT_DEFAULT_SOURCE,
    });

    const anchorHits = await getPreventDefaultHits(projectDir, { framework: "vite" });
    expect(anchorHits).toHaveLength(1);
    expect(anchorHits[0].message).toContain("<button>");
    expect(anchorHits[0].message).not.toContain("server action");
  });

  it("suppresses dialog/local-only forms (canonical SPA pattern)", async () => {
    const projectDir = createViteProject("vite-dialog-form", {
      "src/confirm-dialog.tsx": DIALOG_FORM_SOURCE,
    });

    await expect(getPreventDefaultHits(projectDir, { framework: "vite" })).resolves.toEqual([]);
  });

  it("does not flag a capitalized <Form> user component", async () => {
    const projectDir = createViteProject("vite-capitalized-form", {
      "src/sign-up.tsx": `import { Form } from "./form-component";

export const SignUp = () => (
  <Form
    onSubmit={(event: { preventDefault: () => void }) => {
      event.preventDefault();
    }}
  >
    <input />
  </Form>
);
`,
      "src/form-component.tsx": `interface FormProps {
  onSubmit: (event: { preventDefault: () => void }) => void;
  children: React.ReactNode;
}

export const Form = (props: FormProps) => <form onSubmit={props.onSubmit}>{props.children}</form>;
`,
    });

    await expect(getPreventDefaultHits(projectDir, { framework: "vite" })).resolves.toEqual([]);
  });

  it("does not flag a <form> handler that never calls preventDefault", async () => {
    const projectDir = createViteProject("vite-no-prevent-default", {
      "src/sign-up.tsx": `export const SignUp = () => (
  <form
    onSubmit={(event) => {
      console.log(event.type);
    }}
  >
    <input />
  </form>
);
`,
    });

    await expect(getPreventDefaultHits(projectDir, { framework: "vite" })).resolves.toEqual([]);
  });
});

describe("no-prevent-default — Next.js App Router", () => {
  const createNextProject = (caseId: string, files: Record<string, string>): string =>
    setupReactProject(tempRoot, caseId, {
      packageJsonExtras: {
        dependencies: { next: "^15.0.0", react: "^19.0.0", "react-dom": "^19.0.0" },
      },
      files,
    });

  it("flags <form onSubmit preventDefault()> with server-action wording", async () => {
    const projectDir = createNextProject("next-app-form", {
      "src/app/login/page.tsx": `"use client";

${FORM_PREVENT_DEFAULT_SOURCE}`,
    });

    const formHits = await getPreventDefaultHits(projectDir, { framework: "nextjs" });
    expect(formHits).toHaveLength(1);
    expect(formHits[0].message).toContain("server action");
    expect(formHits[0].message).toContain("form action={serverAction}");
  });

  it("still warns on dialog/local-only forms in a server-capable framework (acknowledged precision debt)", async () => {
    // The rule can't yet tell a local-only form (close-modal handler)
    // from a true progressive-enhancement candidate inside a
    // server-capable framework. Pinning the current behavior here so a
    // future precision PR has to flip this assertion intentionally.
    const projectDir = createNextProject("next-app-dialog-form", {
      "src/app/dialog/page.tsx": `"use client";

${DIALOG_FORM_SOURCE}`,
    });

    const dialogHits = await getPreventDefaultHits(projectDir, { framework: "nextjs" });
    expect(dialogHits).toHaveLength(1);
    expect(dialogHits[0].message).toContain("server action");
  });

  it("flags <a onClick preventDefault()> with the anchor message (not server-action wording)", async () => {
    const projectDir = createNextProject("next-app-anchor", {
      "src/app/pager/page.tsx": `"use client";

${ANCHOR_PREVENT_DEFAULT_SOURCE}`,
    });

    const anchorHits = await getPreventDefaultHits(projectDir, { framework: "nextjs" });
    expect(anchorHits).toHaveLength(1);
    expect(anchorHits[0].message).toContain("<button>");
    expect(anchorHits[0].message).not.toContain("server action");
  });

  it("flags <a onClick preventDefault()> when the call is nested inside conditional logic", async () => {
    const projectDir = createNextProject("next-app-anchor-conditional", {
      "src/app/pager/page.tsx": `"use client";

declare const shouldBlock: boolean;

export const Pager = () => (
  <a
    href="#"
    onClick={(event) => {
      if (shouldBlock) {
        event.preventDefault();
      }
    }}
  >
    Next
  </a>
);
`,
    });

    const anchorHits = await getPreventDefaultHits(projectDir, { framework: "nextjs" });
    expect(anchorHits).toHaveLength(1);
    expect(anchorHits[0].message).toContain("<button>");
  });
});

describe("no-prevent-default — TanStack Start", () => {
  it("flags <form onSubmit preventDefault()> with server-action wording", async () => {
    const projectDir = setupReactProject(tempRoot, "tanstack-start-form", {
      packageJsonExtras: {
        dependencies: {
          "@tanstack/react-start": "^1.0.0",
          react: "^19.0.0",
          "react-dom": "^19.0.0",
        },
      },
      files: {
        "src/routes/login.tsx": FORM_PREVENT_DEFAULT_SOURCE,
      },
    });

    const formHits = await getPreventDefaultHits(projectDir, { framework: "tanstack-start" });
    expect(formHits).toHaveLength(1);
    expect(formHits[0].message).toContain("server action");
  });
});

describe("no-prevent-default — Remix", () => {
  it("flags <form onSubmit preventDefault()> with server-action wording", async () => {
    const projectDir = setupReactProject(tempRoot, "remix-form", {
      packageJsonExtras: {
        dependencies: {
          "@remix-run/react": "^2.0.0",
          react: "^19.0.0",
          "react-dom": "^19.0.0",
        },
      },
      files: {
        "app/routes/login.tsx": FORM_PREVENT_DEFAULT_SOURCE,
      },
    });

    const formHits = await getPreventDefaultHits(projectDir, { framework: "remix" });
    expect(formHits).toHaveLength(1);
    expect(formHits[0].message).toContain("server action");
  });
});

describe("no-prevent-default — Create React App (SPA)", () => {
  it("suppresses the <form> onSubmit warning", async () => {
    const projectDir = setupReactProject(tempRoot, "cra-form", {
      packageJsonExtras: {
        dependencies: {
          react: "^19.0.0",
          "react-dom": "^19.0.0",
          "react-scripts": "^5.0.1",
        },
      },
      files: {
        "src/sign-up.tsx": FORM_PREVENT_DEFAULT_SOURCE,
      },
    });

    await expect(getPreventDefaultHits(projectDir, { framework: "cra" })).resolves.toEqual([]);
  });
});

describe("no-prevent-default — Gatsby (mostly SSG, treat as client-only)", () => {
  it("suppresses the <form> onSubmit warning", async () => {
    const projectDir = setupReactProject(tempRoot, "gatsby-form", {
      packageJsonExtras: {
        dependencies: {
          gatsby: "^5.0.0",
          react: "^19.0.0",
          "react-dom": "^19.0.0",
        },
      },
      files: {
        "src/pages/sign-up.tsx": FORM_PREVENT_DEFAULT_SOURCE,
      },
    });

    await expect(getPreventDefaultHits(projectDir, { framework: "gatsby" })).resolves.toEqual([]);
  });
});

describe("no-prevent-default — Expo / React Native", () => {
  it("suppresses <form> in an Expo (react-native-web) project but still flags <a>", async () => {
    const projectDir = setupReactProject(tempRoot, "expo-form-and-anchor", {
      packageJsonExtras: {
        dependencies: {
          expo: "^54.0.0",
          react: "^19.0.0",
          "react-native": "^0.81.0",
        },
      },
      files: {
        "src/web-only.web.tsx": `${FORM_PREVENT_DEFAULT_SOURCE}
${ANCHOR_PREVENT_DEFAULT_SOURCE}`,
      },
    });

    const hits = await getPreventDefaultHits(projectDir, { framework: "expo" });
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("<button>");
  });

  it("suppresses <form> in a bare React Native project", async () => {
    const projectDir = setupReactProject(tempRoot, "rn-form", {
      packageJsonExtras: {
        dependencies: {
          react: "^19.0.0",
          "react-native": "^0.76.0",
        },
      },
      files: {
        "src/sign-up.web.tsx": FORM_PREVENT_DEFAULT_SOURCE,
      },
    });

    await expect(getPreventDefaultHits(projectDir, { framework: "react-native" })).resolves.toEqual(
      [],
    );
  });
});

describe("no-prevent-default — unknown framework", () => {
  it("flags <form onSubmit preventDefault()> with framework-neutral wording (no 'server action')", async () => {
    const projectDir = setupReactProject(tempRoot, "unknown-form", {
      files: {
        "src/sign-up.tsx": FORM_PREVENT_DEFAULT_SOURCE,
      },
    });

    const formHits = await getPreventDefaultHits(projectDir, { framework: "unknown" });
    expect(formHits).toHaveLength(1);
    expect(formHits[0].message).toContain("form won't work without JavaScript");
    expect(formHits[0].message).not.toContain("server action");
  });

  it("flags an arrow-concise-body handler that returns preventDefault()", async () => {
    const projectDir = setupReactProject(tempRoot, "unknown-concise-arrow", {
      files: {
        "src/sign-up.tsx": `export const SignUp = () => (
  <form onSubmit={(event) => event.preventDefault()}>
    <input />
  </form>
);
`,
      },
    });

    const formHits = await getPreventDefaultHits(projectDir, { framework: "unknown" });
    expect(formHits).toHaveLength(1);
    expect(formHits[0].message).toContain("form won't work without JavaScript");
  });
});
