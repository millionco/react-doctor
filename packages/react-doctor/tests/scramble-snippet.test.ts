import { describe, expect, it } from "vite-plus/test";
import { scramble } from "../src/cli/utils/scramble-snippet.js";

describe("scramble", () => {
  it("strips every identifier — including React APIs — and all literals", () => {
    const result = scramble(
      `import { useEffect } from "react";
const secretBusinessName = 42;
useEffect(() => { doSecretThing(secretBusinessName); }, []);`,
      { language: "ts" },
    );
    expect(result).not.toBeNull();
    expect(result!.source).not.toMatch(/useEffect/);
    expect(result!.source).not.toMatch(/secretBusinessName/);
    expect(result!.source).not.toMatch(/doSecretThing/);
    expect(result!.source).not.toMatch(/42/);
  });

  it("scrambles only the minimal node around a diagnostic", () => {
    const source = `import { useEffect, useState } from "react";

export const InvoiceWidget = ({ customerId }: { customerId: string }) => {
  const [total, setTotal] = useState(0);
  useEffect(() => {
    fetchInvoiceTotal(customerId, "acme-corp").then((amount) => {
      setTotal(amount * 1.07);
    });
  }, []);
  return <div className="invoice">{total}</div>;
};`;
    const offset = source.indexOf("useEffect(() =>");
    const whole = scramble(source, { language: "tsx" });
    const minimal = scramble(source, {
      language: "tsx",
      diagnostic: { offset, length: 9 },
    });
    expect(whole).not.toBeNull();
    expect(minimal).not.toBeNull();
    expect(minimal!.nodeType).toBe("CallExpression");
    expect(minimal!.source.length).toBeLessThan(whole!.source.length);
    expect(minimal!.hash).not.toBe(whole!.hash);
  });

  it("is deterministic — same shape, different names, same hash", () => {
    const first = scramble(`const taxRate = 0.07; const grandTotal = subtotal * taxRate;`, {
      language: "ts",
    });
    const second = scramble(`const discount = 0.42; const finalPrice = basePrice * discount;`, {
      language: "ts",
    });
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first!.hash).toBe(second!.hash);
    expect(first!.source).toBe(second!.source);
  });

  it("scrambles everything — imports, custom props, JSX tags, and DOM/a11y attributes", () => {
    const result = scramble(
      `import { Avatar } from "@acme/internal-design-system";
export const Row = ({ customerName }) => (
  <Avatar role="img" alt="profile photo" data-testid="x" $highlighted onClick={() => {}} secretRank={3}>
    {customerName}
  </Avatar>
);`,
      { language: "tsx" },
    );
    expect(result).not.toBeNull();
    expect(result!.source).not.toMatch(/Avatar/);
    expect(result!.source).not.toMatch(/customerName/);
    expect(result!.source).not.toMatch(/secretRank/);
    expect(result!.source).not.toMatch(/\$highlighted/);
    expect(result!.source).not.toMatch(/\brole=/);
    expect(result!.source).not.toMatch(/\balt=/);
    expect(result!.source).not.toMatch(/data-testid=/);
    expect(result!.source).not.toMatch(/onClick=/);
  });

  it("parses value-position generics when language is omitted (tsx→ts fallback)", () => {
    const result = scramble(`const wrap = <Type,>(value: Type) => identity<Type>(value);`);
    expect(result).not.toBeNull();
    expect(result!.source).not.toMatch(/identity/);
    expect(result!.source).not.toMatch(/wrap/);
    const explicit = scramble(`const wrap = <Type,>(value: Type) => identity<Type>(value);`, {
      language: "ts",
    });
    expect(explicit).not.toBeNull();
    expect(result!.source).toBe(explicit!.source);
  });

  it("stays naming-invariant when a name doubles as a var and a JSX attribute", () => {
    const collides = scramble(`({ className }) => <div className={className} />`, {
      language: "tsx",
    });
    const distinct = scramble(`({ role }) => <div className={role} />`, {
      language: "tsx",
    });
    expect(collides).not.toBeNull();
    expect(distinct).not.toBeNull();
    expect(collides!.source).toBe(distinct!.source);
    expect(collides!.hash).toBe(distinct!.hash);
  });

  it("blanks template text without overrunning the span (escapes + interpolation)", () => {
    const result = scramble(
      "const label = `secret\\n${first} and ${second} tail`; export { label };",
      { language: "ts" },
    );
    expect(result).not.toBeNull();
    expect(result!.source).toMatch(/`[^`]*\$\{\w+\}[^`]*\$\{\w+\}[^`]*`/);
    expect(result!.source).not.toMatch(/secret/);
    expect(result!.source).not.toMatch(/tail/);
    expect(scramble(result!.source, { language: "ts" })).not.toBeNull();
  });

  it("keeps the # on private fields so they re-parse and don't collide", () => {
    const result = scramble(
      `class Vault {
  #secret = 1;
  read(secret: number) { return this.#secret + secret; }
}`,
      { language: "ts" },
    );
    expect(result).not.toBeNull();
    expect(result!.source).not.toMatch(/secret/);
    expect(result!.source).toMatch(/#\w+\s*=/);
    expect(result!.source).toMatch(/this\.#\w+/);
    expect(scramble(result!.source, { language: "ts" })).not.toBeNull();
  });

  it("blinds visible JSX text content", () => {
    const result = scramble(`export const Banner = () => <div>Acme confidential roadmap</div>;`, {
      language: "tsx",
    });
    expect(result).not.toBeNull();
    expect(result!.source).not.toMatch(/confidential/);
    expect(result!.source).not.toMatch(/roadmap/);
    expect(result!.source).not.toMatch(/Acme/);
  });

  it("blinds type names on typed bindings and params", () => {
    const result = scramble(
      `const id: AcmeInvoiceId = make();
const lookup = (ref: InternalCustomerRef) => ref;`,
      { language: "ts" },
    );
    expect(result).not.toBeNull();
    expect(result!.source).not.toMatch(/AcmeInvoiceId/);
    expect(result!.source).not.toMatch(/InternalCustomerRef/);
  });
});
