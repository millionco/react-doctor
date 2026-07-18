import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noArithmeticOnOptionalChainedOperand } from "./no-arithmetic-on-optional-chained-operand.js";

describe("no-arithmetic-on-optional-chained-operand", () => {
  it("flags an optional-chained operand divided then formatted via a binding", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `const share = entry?.points / total; share.toFixed(2);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a variable assigned from an optional chain multiplied and formatted", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `const selectedPlanSize = priceSelected?.bytes; const total = selectedPlanSize * planLimit; total.toFixed(0);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an optional-chained operand in a comparison", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `if (config?.limit * factor < threshold) {}`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags negated equality on the result (NaN !== x is always true)", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `const isOffCycle = contestRound?.week_number % 4 !== 0;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag strict-equality flags on the result (NaN-benign class toggle)", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `const classes = cn({
        "bg-purple-100/70": contestRound?.week_number % 4 === 0,
        "bg-blue-100/70": contestRound?.week_number % 4 === 1,
      });`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag loose-equality flags on the result", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `const isEvenRow = row?.index % 2 == 0;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an equality consumer reached through the result binding", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `const remainder = slot?.position % columns; const isLead = remainder === 0;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags an optional-chained operand inside a Math call argument", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `const rounded = Math.round(lineRef?.clientHeight * index);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports only once when both operands are optional chains", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `const ratio = a?.x / b?.y; ratio.toFixed(1);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag additive operators (string-concat / index math)", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `const lastIndex = items?.length - 1; lastIndex.toString();`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when the operand has a ?? fallback", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `const pct = (file?.progress ?? 0) * 100; pct.toFixed(2);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when a binding has a ?? fallback in its initializer", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `const p = file?.progress ?? 0; const pct = p * 100; pct.toFixed(2);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when an enclosing if narrows the same root", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `if (invoice) { const amount = invoice?.total * taxRate; amount.toFixed(2); }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when an && guard narrows the same root", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `const price = product && (product?.unitPrice * qty).toFixed(2);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when a ternary test narrows the same root", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `const price = product ? (product?.unitPrice * qty).toFixed(2) : "0";`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when an if guards the alias binding of a chain (real-world `const size = box?.width; if (size) {...}` idiom)", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `const size = box?.width;
      if (size) { const total = size * scale; total.toFixed(0); }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when a ternary test guards the alias binding (real-world `percent != null ? percent / 100 : undefined` idiom)", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `const percent = leadContext?.contextUsedPercent;
      const label = percent != null ? (percent / 100).toFixed(2) : undefined;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when an && test guards the alias binding (real-world `x ? 0.9 * x : false` shape via &&)", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `const width = node?.width; const scaled = width && (0.9 * width).toFixed(1);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a re-derefed chain after an early-return guard on its alias binding (extract-then-guard idiom)", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `function Price({ item }) {
        const price = item?.price;
        if (!price) return null;
        const total = item?.price * 2;
        return <span>{total.toFixed(2)}</span>;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a re-derefed chain when the alias points at a different property", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `function Price({ item }) {
        const label = item?.label;
        if (!label) return null;
        const total = item?.price * 2;
        return <span>{total.toFixed(2)}</span>;
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag after a preceding early-return guard on the chain root (real-world `if (!invoice) return null;` prelude)", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `function Total({ invoice, taxRate }) {
        if (!invoice) return null;
        const amount = invoice?.total * taxRate;
        return amount.toFixed(2);
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it('does not flag after a preceding early-return guard on the alias binding (real-world `if (typeof value !== "number") return` prelude)', () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `function Chart({ box }) {
        const size = box?.width;
        if (typeof size !== "number") return null;
        const total = size * 2;
        return total.toFixed(0);
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when the result binding is NaN-clamped before the consumer (real-world `if (Number.isNaN(ratio)) ratio = 0;` clamp)", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `let ratio = entry?.points / total;
      if (Number.isNaN(ratio)) ratio = 0;
      ratio.toFixed(2);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags when the binding is reassigned only after the numeric consumer", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `let ratio = entry?.points / total;
      const label = ratio.toFixed(2);
      ratio = 0;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags when the binding is only compound-assigned before the consumer (NaN survives `*=`)", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `let ratio = entry?.points / total;
      ratio *= 2;
      ratio.toFixed(2);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag when only a shadowing inner binding of the same name is consumed", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `function Share({ entry, total, others }) {
        const share = entry?.points / total;
        return others.map((share) => share.toFixed(2));
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a consumer inside a nested closure without shadowing", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `const share = entry?.points / total;
      const render = () => share.toFixed(2);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags an unguarded alias binding despite an unrelated preceding if", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `function Total({ invoice, taxRate, verbose }) {
        if (verbose) console.log("computing");
        const amount = invoice?.total * taxRate;
        return amount.toFixed(2);
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag an optional call form whose result is not the operand", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `const label = stepNumberLabel?.(index * 1); label.toString();`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when there is no numeric consumer downstream", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `const offset = lineRef?.clientHeight * index;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag plain multiplication without an optional chain", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `const area = width * height; area.toFixed(2);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a computed optional index operand", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `const v = row?.[key] * factor; v.toFixed(2);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Derive-first, guard-second ordering (hooks-before-early-returns forces it)", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `function Chart({ data }) {
        const scaled = data?.value * SCALE;
        const [hovered, setHovered] = useState(false);
        if (!data) return null;
        return <div onMouseEnter={() => setHovered(true)}>{scaled.toFixed(1)}</div>;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Ternary root-guard at the consumer (compute eagerly, consume conditionally)", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `function ShareBadge({ entry, total }) {
        const share = entry?.points / total;
        return <span>{entry ? share.toFixed(2) : "—"}</span>;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Truthiness early-return on the RESULT binding (NaN is falsy)", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `function DiscountBadge({ coupon }) {
        const discount = coupon?.percent / 100;
        if (!discount) return null;
        return <span>{discount.toFixed(2)}</span>;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Consumer inside a root-guarded if block", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `function ProgressLabel({ upload }) {
        const pct = upload?.progress * 100;
        if (upload) {
          return <span>{pct.toFixed(0)}%</span>;
        }
        return null;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Comparison-guard on the result binding (NaN > 0 is false)", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `function Discount({ coupon }) {
        const discount = coupon?.percent / 100;
        if (discount > 0) {
          return <em>{discount.toFixed(2)}</em>;
        }
        return null;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: switch on the chain discriminant narrows the root", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `function OrderTotal({ order, taxRate }) {
        switch (order?.status) {
          case "paid": {
            const total = order?.amount * taxRate;
            return <b>{total.toFixed(2)}</b>;
          }
          default:
            return null;
        }
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not retain a switch discriminant guard after the root is written", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `function OrderTotal({ order, taxRate }) {
        switch (order?.status) {
          case "paid": {
            order = undefined;
            const total = order?.amount * taxRate;
            return <b>{total.toFixed(2)}</b>;
          }
          default:
            return null;
        }
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not retain a switch guard through a writing fallthrough case", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `function OrderTotal({ order, taxRate }) {
        switch (order?.status) {
          case "paid":
            order = undefined;
          case "pending":
            return order?.amount * taxRate;
          default:
            return 0;
        }
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps a switch guard when a writing predecessor exits before the case", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `function OrderTotal({ order, taxRate }) {
        switch (order?.status) {
          case "paid":
            order = undefined;
            break;
          case "pending":
            return order?.amount * taxRate;
          default:
            return 0;
        }
        return 0;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores unreachable switch writes after unconditional exits", () => {
    const breakResult = runRule(
      noArithmeticOnOptionalChainedOperand,
      `function OrderTotal({ order, taxRate }) {
        switch (order?.status) {
          case "paid":
            break;
            order = undefined;
          case "pending":
            return order?.amount * taxRate;
          default:
            return 0;
        }
        return 0;
      }`,
    );
    const returnResult = runRule(
      noArithmeticOnOptionalChainedOperand,
      `function OrderTotal({ order, taxRate }) {
        switch (order?.status) {
          case "paid":
            order = undefined;
            return 0;
          case "pending":
            return order?.amount * taxRate;
          default:
            return 0;
        }
      }`,
    );
    const throwResult = runRule(
      noArithmeticOnOptionalChainedOperand,
      `function OrderTotal({ order, taxRate }) {
        switch (order?.status) {
          case "paid":
            throw new Error("paid");
            order = undefined;
          case "pending":
            return order?.amount * taxRate;
          default:
            return 0;
        }
      }`,
    );
    expect(breakResult.diagnostics).toHaveLength(0);
    expect(returnResult.diagnostics).toHaveLength(0);
    expect(throwResult.diagnostics).toHaveLength(0);
  });

  it("orders same-statement switch writes around optional arithmetic", () => {
    const laterArgumentWriteResult = runRule(
      noArithmeticOnOptionalChainedOperand,
      `function OrderTotal({ order, taxRate }) {
        switch (order?.status) {
          case "paid":
            return consume(order?.amount * taxRate, (order = undefined));
          default:
            return 0;
        }
      }`,
    );
    const laterDeclaratorWriteResult = runRule(
      noArithmeticOnOptionalChainedOperand,
      `function OrderTotal({ order, taxRate }) {
        switch (order?.status) {
          case "paid": {
            const total = order?.amount * taxRate, cleared = (order = undefined);
            return total.toFixed(2) + String(cleared);
          }
          default:
            return "0";
        }
      }`,
    );
    const earlierWriteResult = runRule(
      noArithmeticOnOptionalChainedOperand,
      `function OrderTotal({ order, taxRate }) {
        switch (order?.status) {
          case "paid":
            return (order = undefined, (order?.amount * taxRate).toFixed(2));
          default:
            return "0";
        }
      }`,
    );
    expect(laterArgumentWriteResult.diagnostics).toHaveLength(0);
    expect(laterDeclaratorWriteResult.diagnostics).toHaveLength(0);
    expect(earlierWriteResult.diagnostics).toHaveLength(1);
  });

  it("tracks writes through empty and default fallthrough cases", () => {
    const emptyCaseResult = runRule(
      noArithmeticOnOptionalChainedOperand,
      `function OrderTotal({ order, taxRate }) {
        switch (order?.status) {
          case "paid":
            order = undefined;
          case "processing":
          case "pending":
            return order?.amount * taxRate;
          default:
            return 0;
        }
      }`,
    );
    const defaultCaseResult = runRule(
      noArithmeticOnOptionalChainedOperand,
      `function OrderTotal({ order, taxRate }) {
        switch (order?.status) {
          default:
            order = undefined;
          case "paid":
            return order?.amount * taxRate;
        }
      }`,
    );
    expect(emptyCaseResult.diagnostics).toHaveLength(1);
    expect(defaultCaseResult.diagnostics).toHaveLength(1);
  });

  it("stays quiet: Math consumer inside a root-guarded ternary branch", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `function ZoomedWidth({ image, zoom }) {
        const scaled = image?.naturalWidth / zoom;
        const width = image ? Math.round(scaled) : 0;
        return <div style={{ width }} />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: JSX && root-guard at the consumer", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `function Meter({ stats }) {
        const ratio = stats?.score / stats?.max;
        return <div>{stats && <b>{ratio.toFixed(1)}</b>}</div>;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Alias operand with a nullish ternary guard at the consumer", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `function PlanSize({ plan }) {
        const bytes = plan?.storageBytes;
        const gigabytes = bytes / BYTES_PER_GB;
        return <span>{bytes != null ? gigabytes.toFixed(1) : "Unlimited"}</span>;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Else-branch early exit narrows the root for following statements", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `function Gauge({ metrics, limit }) {
        if (metrics) {
          console.debug("rendering gauge");
        } else {
          return null;
        }
        const used = metrics?.used % limit;
        return <span>{used.toFixed(1)}</span>;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags an unguarded consumer before any guard appears", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `const Row = ({ data }) => {
         const scaled = data?.value * 100;
         return <span>{scaled.toFixed(2)}</span>;
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a comparison consumer outside a test position", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `const sorted = rows.sort((a, b) => a?.price * rate < b?.price * rate);`,
    );
    expect(result.diagnostics.length).toBeGreaterThanOrEqual(1);
  });

  it("still flags when a same-named alias lives in a sibling nested function (bugbot)", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `const Checkout = ({ item, config }) => {
        const formatBadge = () => {
          const price = item?.price;
          return price;
        };
        if (config.price) {
          const total = item?.price * config.taxRate;
          return total.toFixed(2);
        }
        return formatBadge();
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a division guarded only by a sibling alias from the same chain", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `const SystemHealthWidget = ({ health }) => {
        const procOnline = health?.processes?.online;
        const procTotal = health?.processes?.total;
        const cells = [];
        cells[2] = procTotal ? Math.max(0.25, procOnline / procTotal) : 0.25;
        return cells;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags when the ternary tests an alias from a DIFFERENT parent chain", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `const Widget = ({ health }) => {
        const procOnline = health?.processes?.online;
        const appTotal = health?.apps?.total;
        return appTotal ? Math.max(0.25, procOnline / 4) : 0.25;
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags inside an if whose test reads a fallback-defaulted sibling alias of the same chain", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `function generateReason(details) {
        const issues = [];
        const timeScore = details.time?.score || 1;
        if (timeScore < 0.7) {
          const actual = details.time?.actual;
          issues.push((actual / 1000).toFixed(1));
        }
        return issues;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag arithmetic whose declarator is only read after a following early-exit guard on the chain", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `const Collections = ({ tags }) =>
        tags?.map((tag) => {
          const pagination = {
            page: 0,
            pageCount: Math.ceil(tag?.blog_articles?.length / 6),
          };
          if (!tag?.blog_articles || tag?.blog_articles.length === 0) {
            return null;
          }
          return <Tabs tag={tag} pagination={pagination} />;
        });`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags when the declarator is read before the following early-exit guard", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `function Report({ tag }) {
        const pagination = { pageCount: Math.ceil(tag?.blog_articles?.length / 6) };
        console.log(pagination.pageCount.toFixed(0));
        if (!tag?.blog_articles) return null;
        return pagination;
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag when the alias in the SAME scope is guarded", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `const Checkout = ({ item, taxRate }) => {
        const price = item?.price;
        if (!price) return null;
        const total = item?.price * taxRate;
        return total.toFixed(2);
      };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not let a root guard prove a deeper optional segment", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `function read(item) {
         if (item) return (item.details?.price * 2).toFixed(2);
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not let a stale mutable alias guard a re-dereferenced chain", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `let price = item?.price;
       price = 1;
       if (price) return (item?.price * 2).toFixed(2);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat a standalone NaN observation as sanitization", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `const ratio = item?.price / 2;
       Number.isNaN(ratio);
       return ratio.toFixed(2);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat a self-assignment as sanitization", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `let ratio = item?.price / 2;
       ratio = ratio;
       return ratio.toFixed(2);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not let a presence-branch early exit guard the following missing path", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `const ratio = item?.price / 2;
       if (item) return null;
       return ratio.toFixed(2);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an optional-chain arithmetic result returned directly", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `function read(item) { return item?.price * 2; }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
