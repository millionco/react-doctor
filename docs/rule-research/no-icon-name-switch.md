# Rule contract: `no-icon-name-switch`

> Stage 1 (`rule-research`) output. Not yet implemented or validated. Source: the
> "one component per icon" failure mode in `designing-for-agents` (catalog #6).
> Stages 2–3 (`rule-writing`, `rule-validate`) require the dev env + RDE harness.

Rule definition:
This rule catches a single component that selects among three or more distinct inline `<svg>` artworks by branching on a prop discriminant (`name`/`type`/`variant`), instead of one component per icon.

Runtime reason:
Every branch's SVG body lives in one module, so a bundler cannot tree-shake the unused ones — importing the component pulls every icon into the bundle even when one is used. The shared file also grows without bound and hides distinct artwork behind one identity, so no icon can be reused, typed, or lazy-loaded on its own.

Detector precision:
Scope-aware (the discriminant must resolve to a parameter/prop) with branch inspection (enumerate the return sites of a switch / if-else chain / indexed object-literal map).

Evidence:

- Common agent output in design-to-code work: a `BrandIcon({ name })` with a `switch (name)` returning ten `<svg>` blocks (the exact antipattern `paper-to-code-components` §3 was written to stop).
- Bundler behavior: a runtime `switch`/object-index over inline JSX is opaque to dead-code elimination; all branches are retained. A `name → imported component` map keeps each icon in its own module and stays tree-shakeable — the valid counterpart.
- Adjacent existing rules (confirm no overlap before building): `no-giant-component`, `no-multi-comp`, `no-nested-component-definition`. None detect prop-discriminated inline-SVG selection.

Strong positives:

- `switch` of inline SVGs keyed by a prop:
  ```tsx
  function Icon({ name }) {
    switch (name) {
      case "kimi": return <svg viewBox="0 0 24 24"><path d="…" /></svg>;
      case "openai": return <svg viewBox="0 0 24 24"><path d="…" /></svg>;
      case "gemini": return <svg viewBox="0 0 24 24"><path d="…" /></svg>;
    }
  }
  ```
- if / else-if chain returning different inline SVG bodies keyed on a prop.
- object-literal map of **inline** SVG elements then indexed by the prop:
  ```tsx
  const icons = { kimi: <svg>…</svg>, openai: <svg>…</svg>, gemini: <svg>…</svg> };
  const Icon = ({ name }) => icons[name];
  ```

False-positive traps (must stay quiet):

- `name → component reference` map (the recommended pattern; tree-shakeable):
  ```tsx
  const icons = { kimi: KimiIcon, openai: OpenAIIcon, gemini: GeminiIcon };
  const Icon = ({ name }) => { const C = icons[name]; return <C />; };
  ```
- variant switch that changes `className` / text / size but renders the **same** structure (e.g. a Button with `variant`).
- a two-branch toggle of one icon's states (open/closed chevron) — below the distinct-artwork threshold.
- a single, parameterized SVG built from props (one icon, not a selector).
- a barrel/re-export module of per-icon components.

In scope for v1:

- A same-file function/arrow component whose body selects by a single prop/param discriminant among ≥3 branches, where ≥3 branches each return JSX whose root is an inline `<svg>` with path-like children (`path`/`circle`/`rect`/`g`/`polygon`).
- Discriminant forms: `switch`, if/else-if chains, and an object-literal-of-inline-SVG indexed by the discriminant.

Out of scope for v1:

- `name → imported/local component reference` maps (explicit non-goal; this is the fix, not the bug).
- Cross-file or imported branch bodies.
- Non-SVG content switches.
- Two-branch toggles.
- Dynamic/computed discriminants that cannot be tied to a prop.

Test seeds:

- Invalid: switch of 3 inline SVGs; if-chain of 3 inline SVGs; object map of 3 inline SVGs indexed by prop; namespace/aliased prop discriminant.
- Valid: object map of component references; 2-branch SVG toggle; Button variant switch on className only; single parameterized SVG; imported-component map; switch returning non-SVG elements.

Open questions:

- Distinct-artwork threshold: 3 or 4 branches? (Pick the value the OSS noise sweep supports.)
- Category + severity: `bundle-size` or `architecture`; almost certainly `warning`. Default-on only if evals are clean; otherwise default-off.
- Is the object-literal-of-inline-SVG form v1 or a v2 follow-up? (Higher detector complexity than the `switch`/if forms.)
- Final name: `no-icon-name-switch` vs `no-svg-switch-component` vs `no-monolithic-icon-component`.

Validation note (blocks stages 2–3):
Medium false-positive risk — distinguishing inline-SVG branches from component-reference branches is the whole game. Per `rule-research` rules, this MUST clear an RDE OSS noise sweep (`rde-eval`) before it ships; treat any false positive as a correctness bug, not acceptable noise.
