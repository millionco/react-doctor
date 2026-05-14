import { describe, expect, it } from "vite-plus/test";

import { collectRuleHits, createScopedTempRoot, setupReactProject } from "./_helpers.js";

const tempRoot = createScopedTempRoot("no-effect-event-handler");

describe("no-effect-event-handler (widened to MemberExpression test root)", () => {
  it("flags the article §5 `if (product.isInCart)` shape", async () => {
    // https://react.dev/learn/you-might-not-need-an-effect#sharing-logic-between-event-handlers
    const projectDir = setupReactProject(tempRoot, "no-effect-event-handler-member-expression", {
      files: {
        "src/ProductPage.tsx": `import { useEffect } from "react";

declare const showNotification: (message: string) => void;

interface Product { isInCart: boolean; name: string }

export const ProductPage = ({ product }: { product: Product }) => {
  useEffect(() => {
    if (product.isInCart) {
      showNotification(\`Added \${product.name} to the shopping cart!\`);
    }
  }, [product]);

  return <div>{product.name}</div>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-effect-event-handler");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("simulating an event handler");
  });

  it("still flags the bare-Identifier shape", async () => {
    const projectDir = setupReactProject(tempRoot, "no-effect-event-handler-identifier", {
      files: {
        "src/Modal.tsx": `import { useEffect } from "react";

export const Modal = ({ isOpen }: { isOpen: boolean }) => {
  useEffect(() => {
    if (isOpen) {
      document.body.classList.add("modal-open");
    }
  }, [isOpen]);
  return <div />;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-effect-event-handler");
    expect(hits).toHaveLength(1);
  });

  it("does NOT flag when the test's root identifier is not in the deps", async () => {
    const projectDir = setupReactProject(tempRoot, "no-effect-event-handler-unrelated-test", {
      files: {
        "src/Page.tsx": `import { useEffect } from "react";

declare const sideEffect: () => void;

export const Page = ({ unrelated }: { unrelated: boolean }) => {
  useEffect(() => {
    if (window.matchMedia("(max-width: 600px)").matches) {
      sideEffect();
    }
  }, [unrelated]);
  return <div />;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-effect-event-handler");
    expect(hits).toHaveLength(0);
  });
});
