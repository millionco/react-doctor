import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noPreventDefault } from "./no-prevent-default.js";

const remixSettings = {
  "react-doctor": { capabilities: ["server-actions"], framework: "remix" },
};
const nextjsSettings = {
  "react-doctor": { capabilities: ["server-actions"], framework: "nextjs" },
};

describe("correctness/no-prevent-default regressions", () => {
  describe("href-less anchors (anchor-as-button, mined ant-design Dropdown trigger FP)", () => {
    it("stays silent on a concise-arrow bare preventDefault trigger with no href", () => {
      const result = runRule(
        noPreventDefault,
        `export const Trigger = () => (
  <a onClick={(event) => event.preventDefault()}>Hover me</a>
);
`,
        { filename: "src/trigger.tsx" },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("stays silent on a block-body bare preventDefault trigger with no href", () => {
      const result = runRule(
        noPreventDefault,
        `export const Trigger = () => (
  <a
    onClick={(event) => {
      event.preventDefault();
    }}
  >
    Hover me
  </a>
);
`,
        { filename: "src/trigger.tsx" },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("flags an href-less anchor whose spread can forward a real href at runtime", () => {
      const result = runRule(
        noPreventDefault,
        `interface LinkProps {
  href?: string;
}

export const Link = (props: LinkProps) => (
  <a {...props} onClick={(event) => event.preventDefault()}>
    Open
  </a>
);
`,
        { filename: "src/link.tsx" },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("stays silent on a spread anchor whose handler navigates itself", () => {
      const result = runRule(
        noPreventDefault,
        `declare const router: { push: (path: string) => void };

interface LinkProps {
  href?: string;
}

export const Link = (props: LinkProps) => (
  <a
    {...props}
    onClick={(event) => {
      event.preventDefault();
      router.push("/next");
    }}
  >
    Open
  </a>
);
`,
        { filename: "src/link.tsx" },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("stays silent on the ant-design dropdown trigger anchor in a demo file (test-noise)", () => {
      const result = runRule(
        noPreventDefault,
        `export default function App() {
        return (
          <Dropdown menu={{ items }}>
            <a onClick={(e) => e.preventDefault()}>
              <Space>Hover me</Space>
            </a>
          </Dropdown>
        );
      }`,
        { filename: "components/dropdown/demo/basic.tsx" },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("stays silent on the same anchor in a __tests__ file (test-noise)", () => {
      const result = runRule(
        noPreventDefault,
        `export default function App() { return <a onClick={(e) => e.preventDefault()}>Hover me</a>; }`,
        { filename: "components/dropdown/__tests__/index.test.tsx" },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });
  });

  describe("anchors with an href stay flagged when the handler never navigates", () => {
    it('flags href="#" with a bare preventDefault handler', () => {
      const result = runRule(
        noPreventDefault,
        `export const Pager = () => (
  <a
    href="#"
    onClick={(event) => {
      event.preventDefault();
    }}
  >
    Next
  </a>
);
`,
        { filename: "src/pager.tsx" },
      );
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].message).toContain("<button>");
    });

    it("flags a real https href with a bare preventDefault handler", () => {
      const result = runRule(
        noPreventDefault,
        `export const External = () => (
  <a href="https://example.com" onClick={(event) => event.preventDefault()}>
    External
  </a>
);
`,
        { filename: "src/external.tsx" },
      );
      expect(result.diagnostics).toHaveLength(1);
    });

    it("flags a dead link whose handler only tracks analytics after preventDefault (no over-broad any-call exemption)", () => {
      const result = runRule(
        noPreventDefault,
        `declare const analytics: { track: (name: string) => void };

export const Cta = () => (
  <a
    href="/checkout"
    onClick={(event) => {
      event.preventDefault();
      analytics.track("cta_click");
    }}
  >
    Checkout
  </a>
);
`,
        { filename: "src/cta.tsx" },
      );
      expect(result.diagnostics).toHaveLength(1);
    });

    it("flags a dead link whose handler only console.logs after preventDefault", () => {
      const result = runRule(
        noPreventDefault,
        `export const Docs = () => (
  <a
    href="/docs"
    onClick={(event) => {
      event.preventDefault();
      console.log("clicked");
    }}
  >
    Docs
  </a>
);
`,
        { filename: "src/docs.tsx" },
      );
      expect(result.diagnostics).toHaveLength(1);
    });

    it("flags a dead link whose handler pushes into an array after preventDefault (push needs a navigation receiver)", () => {
      const result = runRule(
        noPreventDefault,
        `declare const items: string[];

export const Queue = () => (
  <a
    href="/queue"
    onClick={(event) => {
      event.preventDefault();
      items.push("queued");
    }}
  >
    Queue
  </a>
);
`,
        { filename: "src/queue.tsx" },
      );
      expect(result.diagnostics).toHaveLength(1);
    });

    it("flags a dead link whose handler only string-replaces after preventDefault (replace needs a navigation receiver)", () => {
      const result = runRule(
        noPreventDefault,
        `declare const text: string;
declare const setLabel: (label: string) => void;

export const Label = () => (
  <a
    href="/label"
    onClick={(event) => {
      event.preventDefault();
      setLabel(text.replace("a", "b"));
    }}
  >
    Label
  </a>
);
`,
        { filename: "src/label.tsx" },
      );
      expect(result.diagnostics).toHaveLength(1);
    });

    it("flags a dead link whose handler only Object.assigns after preventDefault (assign needs a navigation receiver)", () => {
      const result = runRule(
        noPreventDefault,
        `declare const state: { clicked: boolean };

export const Merge = () => (
  <a
    href="/merge"
    onClick={(event) => {
      event.preventDefault();
      Object.assign(state, { clicked: true });
    }}
  >
    Merge
  </a>
);
`,
        { filename: "src/merge.tsx" },
      );
      expect(result.diagnostics).toHaveLength(1);
    });
  });

  describe("anchors whose handler performs its own navigation are exempt", () => {
    it("stays silent when the handler opens the link through a platform bridge (CLI pin shape)", () => {
      const result = runRule(
        noPreventDefault,
        `declare const platform: { openLink: (href: string) => void };

export const Link = ({ href }: { href?: string }) => (
  <a
    href={href}
    onClick={(event) => {
      if (!href) return;
      event.preventDefault();
      platform.openLink(href);
    }}
  >
    Open
  </a>
);
`,
        { filename: "src/link.tsx" },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("stays silent when the handler calls a router push after preventDefault", () => {
      const result = runRule(
        noPreventDefault,
        `declare const router: { push: (href: string) => void };

export const NavLink = () => (
  <a
    href="/settings"
    onClick={(event) => {
      event.preventDefault();
      router.push("/settings");
    }}
  >
    Settings
  </a>
);
`,
        { filename: "src/nav-link.tsx" },
      );
      expect(result.diagnostics).toEqual([]);
    });

    it("stays silent when the handler pushes through a props.router-style member", () => {
      const result = runRule(
        noPreventDefault,
        `export const NavLink = (props: { router: { push: (href: string) => void } }) => (
  <a
    href="/settings"
    onClick={(event) => {
      event.preventDefault();
      props.router.push("/settings");
    }}
  >
    Settings
  </a>
);
`,
        { filename: "src/nav-link.tsx" },
      );
      expect(result.diagnostics).toEqual([]);
    });

    it("stays silent when the handler replaces through history after preventDefault", () => {
      const result = runRule(
        noPreventDefault,
        `declare const history: { replace: (href: string) => void };

export const BackLink = () => (
  <a
    href="/back"
    onClick={(event) => {
      event.preventDefault();
      history.replace("/back");
    }}
  >
    Back
  </a>
);
`,
        { filename: "src/back-link.tsx" },
      );
      expect(result.diagnostics).toEqual([]);
    });

    it("stays silent when the handler opens through window after preventDefault", () => {
      const result = runRule(
        noPreventDefault,
        `export const Docs = () => (
  <a
    href="/docs"
    onClick={(event) => {
      event.preventDefault();
      window.open("/docs", "_blank");
    }}
  >
    Docs
  </a>
);
`,
        { filename: "src/docs.tsx" },
      );
      expect(result.diagnostics).toEqual([]);
    });

    it("stays silent when the handler calls a navigate-shaped function after preventDefault", () => {
      const result = runRule(
        noPreventDefault,
        `declare const navigate: (href: string) => void;

export const Pricing = () => (
  <a
    href="/pricing"
    onClick={(event) => {
      event.preventDefault();
      navigate("/pricing");
    }}
  >
    Pricing
  </a>
);
`,
        { filename: "src/pricing.tsx" },
      );
      expect(result.diagnostics).toEqual([]);
    });

    it("stays silent when the handler delegates to a component prop handler", () => {
      const result = runRule(
        noPreventDefault,
        `export const LinkButton = ({ href, onNavigate }: { href: string; onNavigate: (href: string) => void }) => (
  <a
    href={href}
    onClick={(event) => {
      event.preventDefault();
      onNavigate(href);
    }}
  >
    Go
  </a>
);
`,
        { filename: "src/link-button.tsx" },
      );
      expect(result.diagnostics).toEqual([]);
    });

    it("stays silent when the handler assigns location.href after preventDefault", () => {
      const result = runRule(
        noPreventDefault,
        `export const HardNav = () => (
  <a
    href="/legacy"
    onClick={(event) => {
      event.preventDefault();
      location.href = "/legacy?from=spa";
    }}
  >
    Legacy
  </a>
);
`,
        { filename: "src/hard-nav.tsx" },
      );
      expect(result.diagnostics).toEqual([]);
    });

    it("stays silent when the handler assigns window.location after preventDefault", () => {
      const result = runRule(
        noPreventDefault,
        `export const HardNav = () => (
  <a
    href="/legacy"
    onClick={(event) => {
      event.preventDefault();
      window.location = "/legacy";
    }}
  >
    Legacy
  </a>
);
`,
        { filename: "src/hard-nav.tsx" },
      );
      expect(result.diagnostics).toEqual([]);
    });

    it("stays silent when the handler assigns window.location.href after preventDefault", () => {
      const result = runRule(
        noPreventDefault,
        `export const HardNav = () => (
  <a
    href="/legacy"
    onClick={(event) => {
      event.preventDefault();
      window.location.href = "/legacy?from=spa";
    }}
  >
    Legacy
  </a>
);
`,
        { filename: "src/hard-nav.tsx" },
      );
      expect(result.diagnostics).toEqual([]);
    });

    it("still flags a dead link whose handler assigns an unrelated object's location.href", () => {
      const result = runRule(
        noPreventDefault,
        `declare const draft: { location: { href: string } };

export const DeadLink = () => (
  <a
    href="/checkout"
    onClick={(event) => {
      event.preventDefault();
      draft.location.href = "/checkout";
    }}
  >
    Checkout
  </a>
);
`,
        { filename: "src/dead-link.tsx" },
      );
      expect(result.diagnostics).toHaveLength(1);
    });
  });

  describe("the <form> path fires only with a confirmed server-mutation story", () => {
    it("still flags an action-attribute-less <form> in a server-capable framework", () => {
      const result = runRule(
        noPreventDefault,
        `export const SignUp = () => (
  <form
    onSubmit={(event) => {
      event.preventDefault();
    }}
  >
    <input />
  </form>
);
`,
        { filename: "app/routes/sign-up.tsx", settings: remixSettings },
      );
      expect(result.diagnostics).toHaveLength(1);
    });

    it("still flags an action-less form whose handler only does local work", () => {
      const result = runRule(
        noPreventDefault,
        `declare const setOpen: (isOpen: boolean) => void;

export const Toggle = () => (
  <form
    onSubmit={(event) => {
      event.preventDefault();
      setOpen(true);
    }}
  >
    <button>Go</button>
  </form>
);
`,
        { filename: "app/routes/page.tsx", settings: remixSettings },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("stays silent on a progressively-enhanced form with a native action", () => {
      const result = runRule(
        noPreventDefault,
        `declare const clientSubmit: () => void;

export const Enhanced = () => (
  <form
    action="/submit"
    method="post"
    onSubmit={(event) => {
      event.preventDefault();
      clientSubmit();
    }}
  >
    <button>Go</button>
  </form>
);
`,
        { filename: "app/routes/page.tsx", settings: remixSettings },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });
  });

  describe("client-only form contexts (mined SPA / component-library FP cluster)", () => {
    const CONTROLLED_FORM_SOURCE = `declare const submitSearch: () => void;

export const SearchForm = () => (
  <form
    onSubmit={(event) => {
      event.preventDefault();
      submitSearch();
    }}
  >
    <input name="q" />
  </form>
);
`;

    it("stays silent when the framework is unknown (component library / demo page)", () => {
      const result = runRule(noPreventDefault, CONTROLLED_FORM_SOURCE, {
        filename: "pages/prompt-input/prompt-input-integ.page.tsx",
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("stays silent in Next.js when the module does not declare 'use client' (pages-router shape)", () => {
      const result = runRule(noPreventDefault, CONTROLLED_FORM_SOURCE, {
        filename: "src/ClickhousePage.tsx",
        settings: nextjsSettings,
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("still flags a Next.js 'use client' module (app-router client component)", () => {
      const result = runRule(noPreventDefault, `"use client";\n\n${CONTROLLED_FORM_SOURCE}`, {
        filename: "app/register/register-form.tsx",
        settings: nextjsSettings,
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].message).toContain("server action");
    });

    it("still flags the anchor variant regardless of framework", () => {
      const result = runRule(
        noPreventDefault,
        `export const Pager = () => (
  <a href="#" onClick={(event) => event.preventDefault()}>
    Next
  </a>
);
`,
        { filename: "src/pager.tsx" },
      );
      expect(result.diagnostics).toHaveLength(1);
    });
  });

  describe("disabled-link guards (mined conditional preventDefault FP cluster)", () => {
    it("stays silent when preventDefault only fires behind a readiness guard", () => {
      const result = runRule(
        noPreventDefault,
        `export const PdfLink = ({ pdfReady, href }: { pdfReady: boolean; href?: string }) => (
  <a
    href={href}
    aria-disabled={!pdfReady}
    onClick={(event) => {
      if (!pdfReady) event.preventDefault();
    }}
  >
    Compile volume PDF
  </a>
);
`,
        { filename: "src/pdf-link.tsx" },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("stays silent when the guard uses a logical-and expression", () => {
      const result = runRule(
        noPreventDefault,
        `export const PdfLink = ({ isDisabled }: { isDisabled: boolean }) => (
  <a
    href="/report.pdf"
    onClick={(event) => {
      isDisabled && event.preventDefault();
    }}
  >
    Download
  </a>
);
`,
        { filename: "src/pdf-link.tsx" },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("still flags an unconditional preventDefault after an unrelated guard statement", () => {
      const result = runRule(
        noPreventDefault,
        `declare const log: (name: string) => void;

export const DeadLink = ({ tracked }: { tracked: boolean }) => (
  <a
    href="/checkout"
    onClick={(event) => {
      if (tracked) log("click");
      event.preventDefault();
    }}
  >
    Checkout
  </a>
);
`,
        { filename: "src/dead-link.tsx" },
      );
      expect(result.diagnostics).toHaveLength(1);
    });
  });

  describe("fragment-target anchors (mined skip-link / smooth-scroll FP cluster)", () => {
    it("stays silent on a skip link that focuses its fragment target", () => {
      const result = runRule(
        noPreventDefault,
        `export const SkipToTableLink = ({ tableId }: { tableId: string }) => (
  <a
    href={\`#\${tableId}\`}
    onClick={(event) => {
      event.preventDefault();
      const target = document.getElementById(tableId);
      if (target) target.focus();
    }}
  >
    Skip to data table
  </a>
);
`,
        { filename: "src/skip-link.tsx" },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("stays silent on a smooth-scroll table-of-contents anchor", () => {
      const result = runRule(
        noPreventDefault,
        `declare const scrollToDocsAnchor: (id: string) => void;

export const TocEntry = ({ id, label }: { id: string; label: string }) => (
  <a
    href={\`#\${id}\`}
    onClick={(event) => {
      event.preventDefault();
      scrollToDocsAnchor(id);
    }}
  >
    {label}
  </a>
);
`,
        { filename: "src/toc-entry.tsx" },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("stays silent on a static fragment href with scrollIntoView", () => {
      const result = runRule(
        noPreventDefault,
        `export const StatLink = () => (
  <a
    href="#quiz-results"
    onClick={(event) => {
      event.preventDefault();
      document.getElementById("quiz-results")?.scrollIntoView({ behavior: "smooth" });
    }}
  >
    Attempts
  </a>
);
`,
        { filename: "src/stat-link.tsx" },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it('still flags a bare href="#" even when the handler scrolls', () => {
      const result = runRule(
        noPreventDefault,
        `export const TopLink = () => (
  <a
    href="#"
    onClick={(event) => {
      event.preventDefault();
      window.scrollTo(0, 0);
    }}
  >
    Top
  </a>
);
`,
        { filename: "src/top-link.tsx" },
      );
      expect(result.diagnostics).toHaveLength(1);
    });

    it("still flags a fragment href whose handler never scrolls or focuses", () => {
      const result = runRule(
        noPreventDefault,
        `export const DeadFragment = () => (
  <a
    href="#section"
    onClick={(event) => {
      event.preventDefault();
    }}
  >
    Section
  </a>
);
`,
        { filename: "src/dead-fragment.tsx" },
      );
      expect(result.diagnostics).toHaveLength(1);
    });
  });

  describe('anchor-as-button with role="button" (mined cloudscape wizard-step-list FP)', () => {
    it("stays silent on a spread anchor declaring role=button with full keyboard handling", () => {
      const result = runRule(
        noPreventDefault,
        `export const StepLink = ({ status, handleInteraction }) => (
  <a
    role="button"
    tabIndex={0}
    onClick={(event) => {
      event.preventDefault();
      handleInteraction();
    }}
    onKeyDown={(event) => {
      if (event.key === "Enter") handleInteraction();
    }}
    {...(status === "unvisited" ? { onClick: undefined } : {})}
  >
    Step
  </a>
);
`,
        { filename: "src/step-link.tsx" },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });
  });

  describe("controlled client forms with synchronous submit (mined openflipbook / bulwarkmail / gini FPs)", () => {
    it("stays silent on a controlled form forwarding to a parent callback (openflipbook HintPrompt)", () => {
      const result = runRule(
        noPreventDefault,
        `"use client";
export const HintPrompt = ({ onSubmit }) => {
  const [value, setValue] = useState("");
  const submit = () => onSubmit(value.trim());
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <input type="text" value={value} onChange={(e) => setValue(e.target.value)} />
      <button type="submit">Add</button>
    </form>
  );
};
`,
        { filename: "app/components/hint-prompt.tsx", settings: nextjsSettings },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("stays silent on a controlled form appending to client settings state (bulwarkmail keywords)", () => {
      const result = runRule(
        noPreventDefault,
        `"use client";
export const KeywordForm = ({ keywords, updateSetting }) => {
  const [newKeyword, setNewKeyword] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const trimmed = newKeyword.trim().toLowerCase();
        if (trimmed && !keywords.includes(trimmed)) {
          updateSetting("keywords", [...keywords, trimmed]);
        }
        setNewKeyword("");
      }}
    >
      <input type="text" value={newKeyword} onChange={(e) => setNewKeyword(e.target.value)} />
      <button type="submit">Add</button>
    </form>
  );
};
`,
        { filename: "app/components/keyword-form.tsx", settings: nextjsSettings },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("still flags a controlled form whose inline submit awaits a mutation (tracecat service accounts)", () => {
      const result = runRule(
        noPreventDefault,
        `"use client";
export const ServiceAccountForm = ({ handleSave }) => {
  const [name, setName] = useState("");
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        await handleSave();
      }}
    >
      <input value={name} onChange={(event) => setName(event.target.value)} />
      <button type="submit">Save</button>
    </form>
  );
};
`,
        { filename: "app/components/service-account-form.tsx", settings: nextjsSettings },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("still flags a form-library submit without controlled inputs (umamin register form)", () => {
      const result = runRule(
        noPreventDefault,
        `"use client";
export const RegisterForm = ({ form }) => (
  <form
    onSubmit={(e) => {
      e.preventDefault();
      form.handleSubmit();
    }}
  >
    <form.AppField name="username" />
    <button type="submit">Register</button>
  </form>
);
`,
        { filename: "app/components/register-form.tsx", settings: nextjsSettings },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });
  });
});
