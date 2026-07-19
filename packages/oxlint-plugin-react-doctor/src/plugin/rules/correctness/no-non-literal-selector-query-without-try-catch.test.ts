import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noNonLiteralSelectorQueryWithoutTryCatch } from "./no-non-literal-selector-query-without-try-catch.js";

describe("no-non-literal-selector-query-without-try-catch", () => {
  it("flags closest() on a value from an href-named helper", () => {
    const result = runRule(
      noNonLiteralSelectorQueryWithoutTryCatch,
      `const targetSelector = getHashFromHref(el); el.closest(targetSelector);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags querySelector on a getAttribute('href') value", () => {
    const result = runRule(
      noNonLiteralSelectorQueryWithoutTryCatch,
      `const selector = elementRef.current.getAttribute('href'); document.querySelector(selector);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags matches() on a location.hash argument", () => {
    const result = runRule(noNonLiteralSelectorQueryWithoutTryCatch, `el.matches(location.hash);`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a string-literal selector", () => {
    const result = runRule(
      noNonLiteralSelectorQueryWithoutTryCatch,
      `document.querySelector('.foo > a');`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a CSS-module template interpolation", () => {
    const result = runRule(
      noNonLiteralSelectorQueryWithoutTryCatch,
      "node.querySelector(`.${styles['dismiss-button']}`);",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a SCREAMING_SNAKE selector constant", () => {
    const result = runRule(
      noNonLiteralSelectorQueryWithoutTryCatch,
      `const FOCUSABLE_ELEMENTS_SELECTOR = 'a, button'; container.querySelectorAll(FOCUSABLE_ELEMENTS_SELECTOR);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an opaque props selector value", () => {
    const result = runRule(
      noNonLiteralSelectorQueryWithoutTryCatch,
      `const target = document.querySelector(props.targetSelector);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a CSS.escape-wrapped template", () => {
    const result = runRule(
      noNonLiteralSelectorQueryWithoutTryCatch,
      "container.querySelector(`#${CSS.escape(id)}`);",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an href selector already wrapped in try/catch", () => {
    const result = runRule(
      noNonLiteralSelectorQueryWithoutTryCatch,
      `const selector = el.getAttribute('href'); try { document.querySelector(selector); } catch (error) {}`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a dynamic computed query method", () => {
    const result = runRule(
      noNonLiteralSelectorQueryWithoutTryCatch,
      `const selector = el.getAttribute('href'); document[method](selector);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag getAttribute for a non-href attribute", () => {
    const result = runRule(
      noNonLiteralSelectorQueryWithoutTryCatch,
      `const selector = el.getAttribute('data-target'); document.querySelector(selector);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a CSS.escape-wrapping helper just because its name contains 'hash'", () => {
    const result = runRule(
      noNonLiteralSelectorQueryWithoutTryCatch,
      `const buildHashSelector = (raw) => '#' + CSS.escape(raw.slice(1)); document.querySelector(buildHashSelector(location.hash));`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a router pattern's matches() on location.hash", () => {
    const result = runRule(
      noNonLiteralSelectorQueryWithoutTryCatch,
      `const activeRoute = routes.find((candidateRoute) => candidateRoute.matches(location.hash));`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a hash query dominated by a regex shape guard (rsuite docs idiom)", () => {
    const result = runRule(
      noNonLiteralSelectorQueryWithoutTryCatch,
      `const hash = location.hash; if (/^#[a-zA-Z][\\w-]*$/.test(hash)) { document.querySelector(hash); }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a query in the rejected branch of a selector shape guard", () => {
    const result = runRule(
      noNonLiteralSelectorQueryWithoutTryCatch,
      `const hash = location.hash; if (!/^#[a-zA-Z][\\w-]*$/.test(hash)) { document.querySelector(hash); }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags an unrelated named predicate guard", () => {
    const result = runRule(
      noNonLiteralSelectorQueryWithoutTryCatch,
      `const hash = location.hash; if (isValidTheme(hash)) { document.querySelector(hash); }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a hash query dominated by an indexOf containment guard (semiotic docs idiom)", () => {
    const result = runRule(
      noNonLiteralSelectorQueryWithoutTryCatch,
      `if (this.state.marked.indexOf(window.location.hash) !== -1) { document.querySelector(window.location.hash); }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a hash query behind a startsWith guard that does not validate the rest of the selector", () => {
    const result = runRule(
      noNonLiteralSelectorQueryWithoutTryCatch,
      `const scrollToHash = () => { const hash = location.hash; if (!hash.startsWith('#')) return; document.querySelector(hash); };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags when a selector guard only validates a shadowed binding with the same name", () => {
    const result = runRule(
      noNonLiteralSelectorQueryWithoutTryCatch,
      `const hash = location.hash;
      if (["#safe"].some((hash) => /^#[A-Za-z][\\w-]*$/.test(hash))) {
        document.querySelector(hash);
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a bare truthiness guard over an href prop (design-react-kit idiom)", () => {
    const result = runRule(
      noNonLiteralSelectorQueryWithoutTryCatch,
      `const href = el.getAttribute('href'); if (href) { document.querySelector(href); }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an href-derived query inside a deferred callback defined in a try block", () => {
    const result = runRule(
      noNonLiteralSelectorQueryWithoutTryCatch,
      `try { button.addEventListener('click', () => { document.querySelector(anchor.getAttribute('href')); }); } catch {}`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a deferred callback whose own body wraps the query in try/catch", () => {
    const result = runRule(
      noNonLiteralSelectorQueryWithoutTryCatch,
      `button.addEventListener('click', () => { try { document.querySelector(anchor.getAttribute('href')); } catch {} });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when a hash-named helper regex-validates and returns null (null-guarded call site)", () => {
    const result = runRule(
      noNonLiteralSelectorQueryWithoutTryCatch,
      `const getHashSelector = (rawHash) => (/^#[A-Za-z][\\w-]*$/.test(rawHash) ? rawHash : null);
      const scrollToSection = () => {
        const selector = getHashSelector(window.location.hash);
        if (!selector) return;
        document.querySelector(selector)?.scrollIntoView({ behavior: 'smooth' });
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a Set.has membership guard over literal anchors", () => {
    const result = runRule(
      noNonLiteralSelectorQueryWithoutTryCatch,
      `const SECTION_ANCHORS = new Set(['#about', '#projects']);
      const hash = window.location.hash;
      if (SECTION_ANCHORS.has(hash)) { document.querySelector(hash)?.scrollIntoView(); }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a strict-equality pin against literal hashes", () => {
    const result = runRule(
      noNonLiteralSelectorQueryWithoutTryCatch,
      `const hash = window.location.hash;
      if (hash === '#pricing' || hash === '#faq') { document.querySelector(hash)?.scrollIntoView(); }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag inside a switch case pinning the hash to literals", () => {
    const result = runRule(
      noNonLiteralSelectorQueryWithoutTryCatch,
      `switch (window.location.hash) {
        case '#features':
        case '#pricing': {
          document.querySelector(window.location.hash)?.scrollIntoView();
          break;
        }
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a regex .exec() guard", () => {
    const result = runRule(
      noNonLiteralSelectorQueryWithoutTryCatch,
      `const hash = location.hash; if (/^#[a-zA-Z][\\w-]*$/.exec(hash)) { document.querySelector(hash); }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a named-predicate early-return guard", () => {
    const result = runRule(
      noNonLiteralSelectorQueryWithoutTryCatch,
      `const isValidAnchor = (value) => /^#[A-Za-z][\\w-]*$/.test(value);
      const scrollToHash = () => {
        const hash = window.location.hash;
        if (!isValidAnchor(hash)) return;
        document.querySelector(hash)?.scrollIntoView();
      };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a helper whose only invocation sits inside try/catch", () => {
    const result = runRule(
      noNonLiteralSelectorQueryWithoutTryCatch,
      `const focusAnchorTarget = () => {
        const target = document.querySelector(window.location.hash);
        target?.scrollIntoView();
      };
      try { focusAnchorTarget(); } catch {}`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a helper also invoked outside any try block", () => {
    const result = runRule(
      noNonLiteralSelectorQueryWithoutTryCatch,
      `const focusAnchorTarget = () => { document.querySelector(window.location.hash); };
      try { focusAnchorTarget(); } catch {}
      focusAnchorTarget();`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a preceding literal assertion on the hash in a test", () => {
    const result = runRule(
      noNonLiteralSelectorQueryWithoutTryCatch,
      `it('navigates to the section', () => {
        expect(window.location.hash).toBe('#travel-geography');
        expect(document.querySelector(window.location.hash)).toBeTruthy();
      });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a preceding toMatch assertion on the href", () => {
    const result = runRule(
      noNonLiteralSelectorQueryWithoutTryCatch,
      `for (const link of links) {
        const href = link.getAttribute('href');
        expect(href).toMatch(/^#[a-z][a-z0-9-]*$/);
        expect(document.querySelector(href)).not.toBeNull();
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag the css.escape npm polyfill inside a hash-named helper", () => {
    const result = runRule(
      noNonLiteralSelectorQueryWithoutTryCatch,
      `import cssEscape from 'css.escape';
      const buildHashSelector = (rawHash) => '#' + cssEscape(rawHash.slice(1));
      document.querySelector(buildHashSelector(location.hash));`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag matches() on a route-named receiver", () => {
    const result = runRule(
      noNonLiteralSelectorQueryWithoutTryCatch,
      `if (parentRoute && parentRoute.matches(window.location.hash)) { setExpandedSection(parentRoute.id); }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag inside a .then callback whose chain carries .catch", () => {
    const result = runRule(
      noNonLiteralSelectorQueryWithoutTryCatch,
      `waitForRender().then(() => { document.querySelector(location.hash)?.scrollIntoView(); }).catch(() => {});`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags inside a .then callback with no rejection handler", () => {
    const result = runRule(
      noNonLiteralSelectorQueryWithoutTryCatch,
      `waitForRender().then(() => { document.querySelector(location.hash)?.scrollIntoView(); });`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag when the derived id is regex-validated", () => {
    const result = runRule(
      noNonLiteralSelectorQueryWithoutTryCatch,
      `const hash = window.location.hash;
      const anchorId = hash.slice(1);
      if (/^[A-Za-z][\\w-]*$/.test(anchorId)) { document.querySelector(hash)?.scrollIntoView(); }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an `in` guard against a literal-keyed map", () => {
    const result = runRule(
      noNonLiteralSelectorQueryWithoutTryCatch,
      `const sectionOffsets = { '#hero': 0, '#about': 480 };
      const hash = window.location.hash;
      if (hash in sectionOffsets) { document.querySelector(hash)?.scrollIntoView(); }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an Array.some equality guard over literal anchors", () => {
    const result = runRule(
      noNonLiteralSelectorQueryWithoutTryCatch,
      `const navSections = [{ anchor: '#top' }, { anchor: '#faq' }];
      const hash = window.location.hash;
      if (navSections.some((section) => section.anchor === hash)) { document.querySelector(hash); }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag querying hrefs mapped from a literal nav table", () => {
    const result = runRule(
      noNonLiteralSelectorQueryWithoutTryCatch,
      `const navItems = [
        { href: "#Portofolio", label: "Portofolio" },
        { href: "#Contact", label: "Contact" },
      ];
      const sections = navItems.map((item) => {
        const section = document.querySelector(item.href);
        return section ? { id: item.href, offset: section.offsetTop } : null;
      });`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a scroll handler over a module-level literal link table", () => {
    const result = runRule(
      noNonLiteralSelectorQueryWithoutTryCatch,
      `const homeLinks = [{ href: "#features" }, { href: "#pricing" }];
      export const Header = () => (
        <nav>
          {homeLinks.map((link) => (
            <a
              href={link.href}
              key={link.href}
              onClick={(e) => {
                e.preventDefault();
                const target = document.querySelector(link.href);
                target?.scrollIntoView({ behavior: "smooth" });
              }}
            >
              {link.href}
            </a>
          ))}
        </nav>
      );`,
      { filename: "header.tsx" },
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags iteration over a table with a dynamic href", () => {
    const result = runRule(
      noNonLiteralSelectorQueryWithoutTryCatch,
      `const navItems = [{ href: location.hash }, { href: "#contact" }];
      navItems.forEach((item) => { document.querySelector(item.href); });`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a query on a hash sliced from an href prop behind truthiness guards (Mezzanine anchor idiom)", () => {
    const result = runRule(
      noNonLiteralSelectorQueryWithoutTryCatch,
      `const AnchorItem = ({ href, autoScrollTo }) => {
        const hashIndex = href.indexOf('#');
        const itemHash = hashIndex !== -1 ? href.slice(hashIndex) : '';
        const handleClick = (event) => {
          if (itemHash && typeof window !== 'undefined') {
            event.preventDefault();
            if (autoScrollTo) {
              const targetElement = document.querySelector(itemHash);
              if (targetElement) {
                targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }
            }
          }
        };
        return <a href={href} onClick={handleClick} />;
      };`,
      { filename: "anchor-item.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a query on a slice of an href-named receiver", () => {
    const result = runRule(
      noNonLiteralSelectorQueryWithoutTryCatch,
      `const itemHash = href.slice(href.indexOf('#')); document.querySelector(itemHash);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a ternary whose branches are both untainted", () => {
    const result = runRule(
      noNonLiteralSelectorQueryWithoutTryCatch,
      `const selector = isTop ? '#top' : '#bottom'; document.querySelector(selector);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a sliced href pinned by a dominating regex shape guard", () => {
    const result = runRule(
      noNonLiteralSelectorQueryWithoutTryCatch,
      `const hashIndex = href.indexOf('#');
      const itemHash = hashIndex !== -1 ? href.slice(hashIndex) : '';
      if (/^#[A-Za-z][\\w-]*$/.test(itemHash)) { document.querySelector(itemHash); }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an imported hash-named helper (cross-file sanitizer)", () => {
    const result = runRule(
      noNonLiteralSelectorQueryWithoutTryCatch,
      `import { hashToSelector } from "./utils/hash-to-selector";
      document.querySelector(hashToSelector(window.location.hash))?.scrollIntoView();`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a shared handler whose every call site passes a literal href", () => {
    const result = runRule(
      noNonLiteralSelectorQueryWithoutTryCatch,
      `const scrollToSection = (href) => {
        document.querySelector(href)?.scrollIntoView({ behavior: "smooth" });
      };
      export const Navbar = () => (
        <nav>
          <button onClick={() => scrollToSection("#features")}>Features</button>
          <button onClick={() => scrollToSection("#pricing")}>Pricing</button>
        </nav>
      );`,
      { filename: "navbar.tsx" },
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not trust a literal equality or switch case with an unsafe selector shape", () => {
    const equalityResult = runRule(
      noNonLiteralSelectorQueryWithoutTryCatch,
      `const hash = location.hash; if (hash === "#bad space") document.querySelector(hash);`,
    );
    const switchResult = runRule(
      noNonLiteralSelectorQueryWithoutTryCatch,
      `const hash = location.hash; switch (hash) { case "#bad space": document.querySelector(hash); }`,
    );
    expect(equalityResult.diagnostics).toHaveLength(1);
    expect(switchResult.diagnostics).toHaveLength(1);
  });

  it("respects logical guard polarity", () => {
    const unsafeOrResult = runRule(
      noNonLiteralSelectorQueryWithoutTryCatch,
      `const hash = location.hash; const isValidHash = (value) => /^#[A-Za-z][\\w-]*$/.test(value); isValidHash(hash) || document.querySelector(hash);`,
    );
    const mixedOrResult = runRule(
      noNonLiteralSelectorQueryWithoutTryCatch,
      `const hash = location.hash; const isValidHash = (value) => /^#[A-Za-z][\\w-]*$/.test(value); if (isValidHash(hash) || enabled) document.querySelector(hash);`,
    );
    const safeAndResult = runRule(
      noNonLiteralSelectorQueryWithoutTryCatch,
      `const hash = location.hash; const isValidHash = (value) => /^#[A-Za-z][\\w-]*$/.test(value); isValidHash(hash) && document.querySelector(hash);`,
    );
    expect(unsafeOrResult.diagnostics).toHaveLength(1);
    expect(mixedOrResult.diagnostics).toHaveLength(1);
    expect(safeAndResult.diagnostics).toHaveLength(0);
  });

  it("does not let an outer try suppress a deferred promise callback", () => {
    const result = runRule(
      noNonLiteralSelectorQueryWithoutTryCatch,
      `try { Promise.resolve().then(() => document.querySelector(location.hash)); } catch { recover(); }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("recognizes a TypeScript-wrapped selector method", () => {
    const result = runRule(
      noNonLiteralSelectorQueryWithoutTryCatch,
      `(document.querySelector as typeof document.querySelector)(location.hash);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a hash helper that sanitizes an unrelated value", () => {
    const result = runRule(
      noNonLiteralSelectorQueryWithoutTryCatch,
      `const getHashSelector = (rawHash) => {
        CSS.escape("unused");
        return rawHash;
      };
      document.querySelector(getHashSelector(location.hash));`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a literal nav table whose spread can override href", () => {
    const result = runRule(
      noNonLiteralSelectorQueryWithoutTryCatch,
      `const dynamicLink = { href: location.hash };
      const navItems = [{ href: "#safe", ...dynamicLink }];
      navItems.map((item) => document.querySelector(item.href));`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a nav table whose computed property may be href", () => {
    const result = runRule(
      noNonLiteralSelectorQueryWithoutTryCatch,
      `const propertyName = "href";
      const navItems = [{ [propertyName]: location.hash }];
      navItems.map((item) => document.querySelector(item.href));`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a reassigned literal nav table", () => {
    const result = runRule(
      noNonLiteralSelectorQueryWithoutTryCatch,
      `let navItems = [{ href: "#safe" }];
      navItems = [{ href: location.hash }];
      navItems.map((item) => document.querySelector(item.href));`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat an unrelated assertion as selector validation", () => {
    const result = runRule(
      noNonLiteralSelectorQueryWithoutTryCatch,
      `const hash = location.hash;
      expect(hash).toBeDefined();
      document.querySelector(hash);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("invalidates a selector assertion after reassignment", () => {
    const result = runRule(
      noNonLiteralSelectorQueryWithoutTryCatch,
      `let hash = location.hash;
      expect(hash).toBe("#safe");
      hash = readHash();
      document.querySelector(hash);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not let a deferred reassignment invalidate a selector assertion", () => {
    const result = runRule(
      noNonLiteralSelectorQueryWithoutTryCatch,
      `let hash = location.hash;
      expect(hash).toBe("#safe");
      queueMicrotask(() => { hash = readHash(); });
      document.querySelector(hash);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
