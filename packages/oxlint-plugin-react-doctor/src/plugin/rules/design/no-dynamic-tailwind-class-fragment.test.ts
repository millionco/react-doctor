import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDynamicTailwindClassFragment } from "./no-dynamic-tailwind-class-fragment.js";

describe("no-dynamic-tailwind-class-fragment", () => {
  it("reports dynamic color and arbitrary-value fragments", () => {
    const result = runRule(
      noDynamicTailwindClassFragment,
      `const Example = ({ color, width }) => <><div className={\`bg-\${color}-500/20\`} /><p className={\`text-\${color}-500\`} /><aside className={\`w-[\${width}px]\`} /></>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(3);
  });

  it("reports fragments after Tailwind variants and exact spacing prefixes", () => {
    const result = runRule(
      noDynamicTailwindClassFragment,
      `const Example = ({ color, distance, spacing }) => <><div className={\`hover:bg-\${color}-500\`} /><div className={\`md:focus:-translate-x-\${distance}\`} /><div className={\`my-\${spacing}\`} /></>;`,
    );
    expect(result.diagnostics).toHaveLength(3);
  });

  it("reports fragments embedded later in a recognized utility", () => {
    const result = runRule(
      noDynamicTailwindClassFragment,
      `const Example = ({ shade, opacity, side, width }) => <><div className={\`bg-red-\${shade}\`} /><div className={\`text-slate-500/\${opacity}\`} /><div className={\`border-\${side}-\${width}\`} /></>;`,
    );
    expect(result.diagnostics).toHaveLength(3);
  });

  it("reports a template once when one utility has multiple interpolations", () => {
    const result = runRule(
      noDynamicTailwindClassFragment,
      `const Example = ({ color, shade }) => <div className={\`rounded bg-\${color}-\${shade} px-4\`} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows whole-token conditionals and bindings", () => {
    const result = runRule(
      noDynamicTailwindClassFragment,
      `const Example = ({ active, sizeClass, className }) => <><div className={\`p-4 \${active ? "bg-blue-500" : "bg-gray-500"} text-white\`} /><div className={\`\${sizeClass} text-sm\`} /><div className={\`p-4 \${className}\`} /></>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("allows custom class-name fragments", () => {
    const result = runRule(
      noDynamicTailwindClassFragment,
      `const Example = ({ context, variant, tone }) => <><div className={\`awsui-context-\${context}\`} /><div className={\`my-button-\${variant}\`} /><div className={\`brand-\${tone}-500\`} /></>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("allows static Tailwind classes and dynamic utility prefixes", () => {
    const result = runRule(
      noDynamicTailwindClassFragment,
      `const Example = ({ prefix }) => <><div className="bg-red-500 text-white" /><div className={\`bg-red-500 text-white\`} /><div className={\`\${prefix}-500\`} /></>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("ignores template literals outside className", () => {
    const result = runRule(
      noDynamicTailwindClassFragment,
      `const Example = ({ color }) => <div id={\`bg-\${color}-500\`} data-class={\`text-\${color}-500\`} />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("ignores nested template literals inside whole-token expressions", () => {
    const result = runRule(
      noDynamicTailwindClassFragment,
      `const Example = ({ active, color }) => <div className={\`p-4 \${active ? \`bg-\${color}-500\` : "bg-gray-500"}\`} />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("skips spread-overridable class contracts", () => {
    const result = runRule(
      noDynamicTailwindClassFragment,
      `const Example = ({ color, props }) => <div className={\`bg-\${color}-500\`} {...props} />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });
});
