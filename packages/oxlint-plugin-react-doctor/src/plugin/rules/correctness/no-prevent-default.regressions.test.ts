import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noPreventDefault } from "./no-prevent-default.js";

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

  describe("the <form> path is unchanged by the anchor gates", () => {
    it("still flags an action-attribute-less <form> whose onSubmit calls preventDefault", () => {
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
        { filename: "src/sign-up.tsx" },
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
        { filename: "app/page.tsx" },
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
        { filename: "app/page.tsx" },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });
  });
});
