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
  });
});
