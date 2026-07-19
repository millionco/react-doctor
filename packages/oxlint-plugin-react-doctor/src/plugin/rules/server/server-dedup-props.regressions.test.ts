import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { serverDedupProps } from "./server-dedup-props.js";

describe("server/server-dedup-props — regressions", () => {
  it("stays silent in components that call hooks (data-driven-forms wizard-step shape)", () => {
    const result = runRule(
      serverDedupProps,
      `import { useEffect, useRef } from "react";
      const WizardStep = ({ fields, formOptions }) => {
        const formRef = useRef(null);
        useEffect(() => {
          formRef.current?.scrollTo({ top: 0 });
        }, []);
        return <StepTemplate formFields={fields.map((item) => formOptions.renderForm([item]))} fields={fields} formRef={formRef} />;
      };`,
      { filename: "src/wizard/wizard-components/wizard-step.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent in hook files even when the hook call follows the JSX (jumper-exchange shape)", () => {
    const result = runRule(
      serverDedupProps,
      `const buildAssetsItem = (assets) => (
        <EntityStackWithBadge entities={assets} badgeEntities={assets.map((asset) => asset.chain)} />
      );
      export const useFormatDisplayEarnOpportunityData = (assets) =>
        useMemo(() => buildAssetsItem(assets), [assets]);`,
      { filename: "src/hooks/earn/use-format-display-earn-opportunity-data.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it('stays silent in "use client" files (semiotic quadrant-chart shape)', () => {
    const result = runRule(
      serverDedupProps,
      `"use client";
      export const QuadrantEntry = () => (
        <QuadrantChart data={BACKLOG} annotations={BACKLOG.map((b) => ({ label: b.id }))} />
      );`,
      { filename: "src/blog/entries/quadrant-chart.jsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags duplicate source + projection props in a server component", () => {
    const result = runRule(
      serverDedupProps,
      `export default function UsersPage({ users }) {
        return <ClientList users={users} usersOrdered={users.toSorted((a, b) => a.id - b.id)} />;
      }`,
      { filename: "src/app/users/page.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags each duplicated projection in hook-free server components", () => {
    const result = runRule(
      serverDedupProps,
      `export default async function ProductsPage() {
        const products = await getProducts();
        return <Catalog products={products} featured={products.filter((p) => p.featured)} sorted={products.toSorted()} />;
      }`,
      { filename: "src/app/products/page.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("stays silent when the shared identifier is React's special key attribute", () => {
    const result = runRule(
      serverDedupProps,
      `const ProductList = ({ productKeys }) => productKeys.map((productKey) => (
        <Product key={productKey} size={productKey.slice(-2)} />
      ));`,
      { filename: "common/templates/received-mail.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
