import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { scramble } from "../src/normalize-snippet/normalize-code-snippet.js";

interface Fixture {
  name: string;
  language: "ts" | "tsx" | "js" | "jsx";
  source: string;
}

const FIXTURES: Fixture[] = [
  {
    name: "useEffect with a missing dependency",
    language: "tsx",
    source: `import { useEffect, useState } from "react";

export const InvoiceWidget = ({ customerId }: { customerId: string }) => {
  const [total, setTotal] = useState(0);

  useEffect(() => {
    fetchInvoiceTotal(customerId, "acme-corp").then((amount) => {
      setTotal(amount * 1.07);
    });
  }, []);

  return <div className="invoice">{total}</div>;
};`,
  },
  {
    name: "array index used as a key",
    language: "tsx",
    source: `export const TodoList = ({ todos }) => {
  return (
    <ul>
      {todos.map((todo, index) => (
        <li key={index} title="pending task">{todo.label}</li>
      ))}
    </ul>
  );
};`,
  },
  {
    name: "a secret echoed into client code",
    language: "ts",
    source: `const stripeClient = createClient({
  apiKey: "sk_live_51Hxq9rreally_secret_token_value",
  region: "us-east-1",
});`,
  },
];

describe("scramble", () => {
  for (const fixture of FIXTURES) {
    it(fixture.name, () => {
      const result = scramble(fixture.source, { language: fixture.language });
      assert.ok(result, "should scramble");

      console.log(`\n=== ${fixture.name} ===`);
      console.log("--- INPUT ---");
      console.log(fixture.source);
      console.log("--- SCRAMBLED SOURCE ---");
      console.log(result.source);
      console.log(`hash=${result.hash}`);
    });
  }

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
    const minimal = scramble(source, { language: "tsx", diagnostic: { offset, length: 9 } });
    assert.ok(whole && minimal);

    console.log("\n=== minimal extraction ===");
    console.log(`whole-file scrambled (${whole.source.length}B)`);
    console.log(`minimal node (${minimal.nodeType}, ${minimal.source.length}B):`);
    console.log(minimal.source);

    assert.equal(minimal.nodeType, "CallExpression");
    assert.ok(minimal.source.length < whole.source.length, "minimal node must be smaller");
    assert.notEqual(minimal.hash, whole.hash);
  });

  it("is deterministic — same shape, different names, same hash", () => {
    const first = scramble(`const taxRate = 0.07; const grandTotal = subtotal * taxRate;`, {
      language: "ts",
    });
    const second = scramble(`const discount = 0.42; const finalPrice = basePrice * discount;`, {
      language: "ts",
    });
    assert.ok(first && second);
    assert.equal(first.hash, second.hash);
    assert.equal(first.source, second.source);
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
    assert.ok(result);
    // imported + custom names gone
    assert.doesNotMatch(result.source, /Avatar/);
    assert.doesNotMatch(result.source, /customerName/);
    assert.doesNotMatch(result.source, /secretRank/);
    assert.doesNotMatch(result.source, /\$highlighted/);
    // DOM / a11y attribute names are also scrambled
    assert.doesNotMatch(result.source, /\brole=/);
    assert.doesNotMatch(result.source, /\balt=/);
    assert.doesNotMatch(result.source, /data-testid=/);
    assert.doesNotMatch(result.source, /onClick=/);
  });

  it("parses value-position generics when language is omitted (tsx→ts fallback)", () => {
    // `identity<Thing>(x)` and `<Type,>() => …` misparse as JSX under the
    // default tsx rules; the parse must fall back to ts instead of returning null.
    const result = scramble(`const wrap = <Type,>(value: Type) => identity<Type>(value);`);
    assert.ok(result, "generic TS should parse via the ts fallback");
    assert.doesNotMatch(result.source, /identity/);
    assert.doesNotMatch(result.source, /wrap/);
    // explicit language is authoritative and yields the same scrambled output
    const explicit = scramble(`const wrap = <Type,>(value: Type) => identity<Type>(value);`, {
      language: "ts",
    });
    assert.ok(explicit);
    assert.equal(result.source, explicit.source);
  });

  it("strips every identifier — including React APIs — and all literals", () => {
    const result = scramble(
      `import { useEffect } from "react";
const secretBusinessName = 42;
useEffect(() => { doSecretThing(secretBusinessName); }, []);`,
      { language: "ts" },
    );
    assert.ok(result);
    assert.doesNotMatch(result.source, /useEffect/);
    assert.doesNotMatch(result.source, /secretBusinessName/);
    assert.doesNotMatch(result.source, /doSecretThing/);
    assert.doesNotMatch(result.source, /42/);
  });
});
