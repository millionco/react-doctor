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

// AST-shape edge cases — all run with `framework: "unknown"` so the
// expectations describe the AST walk + attribute guards independently
// of any framework branching. If the rule's `containsPreventDefaultCall`
// walker or `findJsxAttribute` lookup regresses, these fire first.
describe("no-prevent-default — AST shape edge cases", () => {
  it("flags an async arrow handler that calls preventDefault()", async () => {
    const projectDir = setupReactProject(tempRoot, "ast-async-arrow", {
      files: {
        "src/sign-up.tsx": `export const SignUp = () => (
  <form
    onSubmit={async (event) => {
      event.preventDefault();
      await Promise.resolve();
    }}
  >
    <input />
  </form>
);
`,
      },
    });

    const formHits = await getPreventDefaultHits(projectDir, { framework: "unknown" });
    expect(formHits).toHaveLength(1);
  });

  it("flags a FunctionExpression (non-arrow) handler that calls preventDefault()", async () => {
    const projectDir = setupReactProject(tempRoot, "ast-function-expression", {
      files: {
        "src/sign-up.tsx": `export const SignUp = () => (
  <form
    onSubmit={function handle(event) {
      event.preventDefault();
    }}
  >
    <input />
  </form>
);
`,
      },
    });

    const formHits = await getPreventDefaultHits(projectDir, { framework: "unknown" });
    expect(formHits).toHaveLength(1);
  });

  it("does NOT flag a referenced handler (rule cannot see into named references)", async () => {
    // HACK: pins the current limitation. The rule only inspects inline
    // ArrowFunctionExpression / FunctionExpression handlers; once the
    // handler is hoisted to a named binding the rule body conservatively
    // skips it. A future precision PR could chase the reference, but
    // until then this regression documents the conscious gap so we
    // don't accidentally regress in the other direction.
    const projectDir = setupReactProject(tempRoot, "ast-referenced-handler", {
      files: {
        "src/sign-up.tsx": `const handleSubmit = (event: { preventDefault: () => void }) => {
  event.preventDefault();
};

export const SignUp = () => (
  <form onSubmit={handleSubmit}>
    <input />
  </form>
);
`,
      },
    });

    await expect(getPreventDefaultHits(projectDir, { framework: "unknown" })).resolves.toEqual([]);
  });

  it("flags preventDefault() reached through a nested closure inside the handler", async () => {
    const projectDir = setupReactProject(tempRoot, "ast-nested-closure", {
      files: {
        "src/sign-up.tsx": `export const SignUp = () => (
  <form
    onSubmit={(event) => {
      const stop = () => event.preventDefault();
      stop();
    }}
  >
    <input />
  </form>
);
`,
      },
    });

    const formHits = await getPreventDefaultHits(projectDir, { framework: "unknown" });
    expect(formHits).toHaveLength(1);
  });

  it("flags a block-body handler that returns the preventDefault() call", async () => {
    const projectDir = setupReactProject(tempRoot, "ast-block-return", {
      files: {
        "src/sign-up.tsx": `export const SignUp = () => (
  <form
    onSubmit={(event) => {
      return event.preventDefault();
    }}
  >
    <input />
  </form>
);
`,
      },
    });

    const formHits = await getPreventDefaultHits(projectDir, { framework: "unknown" });
    expect(formHits).toHaveLength(1);
  });

  it("flags a self-closing <form onSubmit={...} />", async () => {
    const projectDir = setupReactProject(tempRoot, "ast-self-closing", {
      files: {
        "src/sign-up.tsx": `export const SignUp = () => (
  <form
    onSubmit={(event) => {
      event.preventDefault();
    }}
  />
);
`,
      },
    });

    const formHits = await getPreventDefaultHits(projectDir, { framework: "unknown" });
    expect(formHits).toHaveLength(1);
  });

  it("flags a <form> rendered inside a .map() callback", async () => {
    const projectDir = setupReactProject(tempRoot, "ast-mapped-form", {
      files: {
        "src/sign-up-list.tsx": `export const SignUpList = ({ rows }: { rows: { id: string }[] }) => (
  <>
    {rows.map((row) => (
      <form
        key={row.id}
        onSubmit={(event) => {
          event.preventDefault();
        }}
      >
        <input name={row.id} />
      </form>
    ))}
  </>
);
`,
      },
    });

    const formHits = await getPreventDefaultHits(projectDir, { framework: "unknown" });
    expect(formHits).toHaveLength(1);
  });

  it("flags every <form> independently when two appear in the same file", async () => {
    const projectDir = setupReactProject(tempRoot, "ast-two-forms", {
      files: {
        "src/sign-up.tsx": `export const SignUp = () => (
  <>
    <form
      onSubmit={(event) => {
        event.preventDefault();
      }}
    >
      <input name="first" />
    </form>
    <form
      onSubmit={(event) => {
        event.preventDefault();
      }}
    >
      <input name="second" />
    </form>
  </>
);
`,
      },
    });

    const formHits = await getPreventDefaultHits(projectDir, { framework: "unknown" });
    expect(formHits).toHaveLength(2);
  });

  it("does NOT flag <form onSubmitCapture> (attribute-name guard)", async () => {
    const projectDir = setupReactProject(tempRoot, "ast-on-submit-capture", {
      files: {
        "src/sign-up.tsx": `export const SignUp = () => (
  <form
    onSubmitCapture={(event) => {
      event.preventDefault();
    }}
  >
    <input />
  </form>
);
`,
      },
    });

    await expect(getPreventDefaultHits(projectDir, { framework: "unknown" })).resolves.toEqual([]);
  });

  it("does NOT flag <a onClickCapture> (attribute-name guard)", async () => {
    const projectDir = setupReactProject(tempRoot, "ast-on-click-capture", {
      files: {
        "src/pager.tsx": `export const Pager = () => (
  <a
    href="#"
    onClickCapture={(event) => {
      event.preventDefault();
    }}
  >
    Next
  </a>
);
`,
      },
    });

    await expect(getPreventDefaultHits(projectDir, { framework: "unknown" })).resolves.toEqual([]);
  });

  it("does NOT flag <form onSubmit={undefined}> (handler isn't an arrow/function expression)", async () => {
    const projectDir = setupReactProject(tempRoot, "ast-undefined-handler", {
      files: {
        "src/sign-up.tsx": `export const SignUp = () => (
  <form onSubmit={undefined}>
    <input />
  </form>
);
`,
      },
    });

    await expect(getPreventDefaultHits(projectDir, { framework: "unknown" })).resolves.toEqual([]);
  });

  it("does NOT flag a capitalized <A> user component (anchor tag-name guard)", async () => {
    const projectDir = setupReactProject(tempRoot, "ast-capitalized-anchor", {
      files: {
        "src/pager.tsx": `import { A } from "./anchor";

export const Pager = () => (
  <A
    onClick={(event: { preventDefault: () => void }) => {
      event.preventDefault();
    }}
  >
    Next
  </A>
);
`,
        "src/anchor.tsx": `interface AnchorProps {
  onClick: (event: { preventDefault: () => void }) => void;
  children: React.ReactNode;
}

export const A = (props: AnchorProps) => <a onClick={props.onClick}>{props.children}</a>;
`,
      },
    });

    await expect(getPreventDefaultHits(projectDir, { framework: "unknown" })).resolves.toEqual([]);
  });

  it("still flags <a> when other unrelated attributes are present (target, rel, etc.)", async () => {
    const projectDir = setupReactProject(tempRoot, "ast-anchor-extra-attrs", {
      files: {
        "src/pager.tsx": `export const Pager = () => (
  <a
    href="https://example.com"
    target="_blank"
    rel="noopener noreferrer"
    onClick={(event) => {
      event.preventDefault();
    }}
  >
    External
  </a>
);
`,
      },
    });

    const anchorHits = await getPreventDefaultHits(projectDir, { framework: "unknown" });
    expect(anchorHits).toHaveLength(1);
    expect(anchorHits[0].message).toContain("<button>");
  });
});

// Optional chaining produces `ChainExpression > CallExpression(optional)
// > MemberExpression(optional, property=Identifier "preventDefault")`
// in ESTree. The rule's generic `walkAst` traverses the ChainExpression
// wrapper transparently and matches the inner CallExpression. This pins
// that behavior so a future "switch to a stricter walker" refactor has
// to consciously re-add coverage if it changes.
describe("no-prevent-default — optional chaining", () => {
  it("flags `event?.preventDefault?.()` in a <form> handler", async () => {
    const projectDir = setupReactProject(tempRoot, "optional-chain-form", {
      files: {
        "src/sign-up.tsx": `export const SignUp = () => (
  <form
    onSubmit={(event) => {
      event?.preventDefault?.();
    }}
  >
    <input />
  </form>
);
`,
      },
    });

    const formHits = await getPreventDefaultHits(projectDir, { framework: "unknown" });
    expect(formHits).toHaveLength(1);
  });

  it("flags `event?.preventDefault()` in an <a> handler (half-optional chain)", async () => {
    const projectDir = setupReactProject(tempRoot, "optional-chain-anchor", {
      files: {
        "src/pager.tsx": `export const Pager = () => (
  <a
    href="#"
    onClick={(event) => {
      event?.preventDefault();
    }}
  >
    Next
  </a>
);
`,
      },
    });

    const anchorHits = await getPreventDefaultHits(projectDir, { framework: "unknown" });
    expect(anchorHits).toHaveLength(1);
  });
});

// Currently `framework: "nextjs"` resolves the same way for App Router
// and Pages Router. Pages Router has no RSC Server Actions; the
// `<form action={serverAction}>` recommendation only literally applies
// to App Router. We still ship the same "server action" message in
// both routers because (a) the broader "use a form action for
// progressive enhancement" idea is still correct on Pages Router via
// classic `<form action="/api/route" method="POST">`, and (b) we don't
// yet have per-file router-type detection in this rule.
//
// Pin the current behavior so a future router-aware precision PR
// (mirroring `nextjs-no-client-side-redirect`'s split) has to flip
// these assertions intentionally.
describe("no-prevent-default — Next.js Pages Router (precision-debt pin)", () => {
  it("still fires with server-action wording on Pages Router forms (acknowledged limitation)", async () => {
    const projectDir = setupReactProject(tempRoot, "next-pages-form", {
      packageJsonExtras: {
        dependencies: { next: "^15.0.0", react: "^19.0.0", "react-dom": "^19.0.0" },
      },
      files: {
        "src/pages/login.tsx": FORM_PREVENT_DEFAULT_SOURCE,
      },
    });

    const formHits = await getPreventDefaultHits(projectDir, { framework: "nextjs" });
    expect(formHits).toHaveLength(1);
    expect(formHits[0].message).toContain("server action");
  });
});
