import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noArrayFindResultMemberAccessWithoutGuard } from "./no-array-find-result-member-access-without-guard.js";

const FIND_CALL_COUNT = 600;
const MAX_ANALYSIS_DURATION_MS = 2_000;

describe("no-array-find-result-member-access-without-guard", () => {
  it("flags a property read on a find() result (locale-lookup shape)", () => {
    const result = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `const id = response.data.locales.find((i) => i.locale === targetLocale).id;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an index access on a find() result", () => {
    const result = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `const first = items.find((item) => item.active)[0];`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("supports a statically computed find method", () => {
    const result = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `const name = users["find"]((user) => user.id === id).name;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat a local object find method as Array.prototype.find", () => {
    const result = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `const index = { find: (predicate) => ({ name: "always" }) };
      const name = index.find((item) => item.id === id).name;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a call on a find() result", () => {
    const result = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `const value = handlers.find((h) => h.type === type)();`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags findLast() the same way", () => {
    const result = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `const name = users.findLast((u) => u.enabled).name;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an identifier-predicate find()", () => {
    const result = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `const isActive = (u) => u.active; const email = users.find(isActive).email;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags through parentheses", () => {
    const result = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `const id = (rows.find((r) => r.ok)).id;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag optional-chained access", () => {
    const result = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `const id = items.find((item) => item.active)?.id;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag optional-chained call", () => {
    const result = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `const value = handlers.find((h) => h.type === type)?.();`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a nullish-coalescing fallback", () => {
    const result = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `const item = items.find((item) => item.active) ?? defaultItem;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a find() result bound to a variable then guarded", () => {
    const result = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `
      const found = items.find((item) => item.active);
      if (found) {
        doSomething(found.id);
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag ORM Model.find(callback) with a capitalized receiver", () => {
    const result = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `const email = User.find((u) => u.id === 5).email;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag ORM Model.find({ where }) object query", () => {
    const result = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `const email = repo.find({ where: { id: 5 } }).email;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an ORM find query terminated by exec", () => {
    const result = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `const query = findModel(itemsType).find(criteria).exec(callback);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags exec access on a possibly missing array element", () => {
    const result = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `[{ exec() {} }].find((command) => command.ready).exec();
       const commands = [{ exec() {} }];
       commands.find(isReady).exec();`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("flags array-shaped find access on an opaque call result", () => {
    const result = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `const name = getUsers().find((user) => user.active).name;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags find after a proven array-producing call", () => {
    const result = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `const label = items.filter((item) => item.visible).find((item) => item.id === id).label;
       const name = Array.from(users).find((user) => user.id === id).name;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("does not flag a non-null-asserted result (owned by the no-non-null rule)", () => {
    const result = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `const id = items.find((item) => item.active)!.id;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when the find() result is not immediately accessed", () => {
    const result = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `const found = items.find((item) => item.active);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an enzyme wrapper.find(Component).instance() chain", () => {
    const result = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `const inst = wrapper.find(AvatarImage).instance();`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an enzyme wrapper.find(Component).first().props() chain", () => {
    const result = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `const pop = wrapper.find(Tooltip).first().props();`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an enzyme wrapper.find(Component).length read", () => {
    const result = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `expect(wrapper.find(VisuallyHidden).length).toBe(4);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags find(Boolean) first-truthy dereference (not an enzyme component selector)", () => {
    const result = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `const first = values.find(Boolean).id;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag the pre-ES2020 `find(f) && find(f).x` repeated-call guard", () => {
    const result = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `const label = items.find((i) => i.active) && items.find((i) => i.active).label;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag the `find(f) ? find(f).x : y` repeated-call ternary guard", () => {
    const result = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `const label = items.find((i) => i.id === id) ? items.find((i) => i.id === id).label : "";`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a repeated-call guard inside an if statement", () => {
    const result = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `
      if (items.find((i) => i.id === id)) {
        doSomething(items.find((i) => i.id === id).label);
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags when the truthiness test is a different find call", () => {
    const result = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `const label = items.find((i) => i.active) && items.find((i) => i.selected).label;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a custom callback lookup because a sibling map does not prove callback provenance", () => {
    const result = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `
      const Dropdown = ({ items }) => (
        <ModalDropdown
          options={items.map((item) => item.label)}
          onSelect={(value) => selectItem(items.find((item) => item.label === value).value)}
        />
      );
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags an equality lookup whose key does not come from a sibling map of the array", () => {
    const result = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `const name = users.find((u) => u.id === userId).name;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a non-identity predicate even when the array is mapped in the same scope", () => {
    const result = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `
      const Sessions = ({ sessions }) => {
        const labels = sessions.map((session) => session.label);
        return renderBadge(labels, sessions.find((session) => session.confirmed === true).id);
      };
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a real array find() dereference inside a test file", () => {
    const result = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `const id = items.find((item) => item.active).id;`,
      { filename: "widget.test.ts" },
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a select lookup because DOM values can be stale or programmatically changed", () => {
    const result = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `const CurrencySelect = ({ options, onChange }) => (
         <select
           onChange={(event) =>
             onChange(options.find((option) => option.code === event.target.value).id)
           }
         >
           {options.map((option) => (
             <option key={option.id} value={option.code}>
               {option.label}
             </option>
           ))}
         </select>
       );`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a props lookup when only a sibling custom-component projection exists", () => {
    const result = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `const Dropdown = (props) => (
         <Select
           options={props.items.map((item) => item.label)}
           onSelect={(value) => props.onPick(props.items.find((item) => item.label === value).value)}
         />
       );`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a class-component lookup when only a sibling projection exists", () => {
    const result = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `class Picker extends React.Component {
         render() {
           return (
             <Select
               options={this.props.options.map((option) => option.code)}
               onSelect={(code) =>
                 this.props.onPick(this.props.options.find((option) => option.code === code).label)
               }
             />
           );
         }
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags when an unrelated same-file helper maps the receiver", () => {
    const result = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `const toOptionLabels = (items) => items.map((item) => item.label);
       const Dropdown = ({ items, onPick }) => (
         <Select
           options={toOptionLabels(items)}
           onSelect={(value) => onPick(items.find((item) => item.label === value).value)}
         />
       );`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet after an early-return negated repeated-find guard", () => {
    const result = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `function label(items, id) {
         if (!items.find((item) => item.id === id)) return null;
         return items.find((item) => item.id === id).label;
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet in the else branch of a negated repeated-find test", () => {
    const result = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `function label(items, id) {
         if (!items.find((item) => item.id === id)) {
           return null;
         } else {
           return items.find((item) => item.id === id).label;
         }
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet in the ternary alternate after an explicit === undefined test", () => {
    const result = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `const label = items.find((item) => item.id === id) === undefined
         ? 'none'
         : items.find((item) => item.id === id).label;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet in the alternate of a negated ternary with a fallback consequent", () => {
    const result = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `const label = !items.find((item) => item.id === id)
         ? 'none'
         : items.find((item) => item.id === id).label;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when a some() guard with the identical predicate precedes the find", () => {
    const result = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `function label(items, id) {
         if (items.some((item) => item.id === id)) {
           return items.find((item) => item.id === id).label;
         }
         return null;
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when the deref sits in an inline handler under a conditional-render guard", () => {
    const result = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `const Toolbar = ({ items, selectedId, onSave }) => (
         <div>
           {items.find((item) => item.id === selectedId) && (
             <button onClick={() => onSave(items.find((item) => item.id === selectedId).name)}>
               Save
             </button>
           )}
         </div>
       );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet on a lodash chain find unwrapped with .value()", () => {
    const result = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `const admin = _.chain(users)
         .filter((user) => user.enabled)
         .find((user) => user.role === "admin")
         .value();`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet on find(Boolean) over an array literal ending in a truthy literal", () => {
    const result = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `const direction = [override, stored, "ltr"].find(Boolean).toUpperCase();`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags find(Boolean) over an array literal with no truthy literal element", () => {
    const result = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `const direction = [override, stored].find(Boolean).toUpperCase();`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet when the conditional-render guard uses the optional-chained spelling of the same find", () => {
    const result = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `const TaskItem = ({ task, apps }) => (
         <div>
           {task.metadata?.app && apps?.find((a) => a.id === task.metadata.app)?.name && (
             <span title={task.metadata.app}>
               {apps.find((a) => a.id === task.metadata.app).name}
             </span>
           )}
         </div>
       );`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a MongoDB cursor find(filter) whose argument resolves to an object literal", () => {
    const result = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `async function listNodes(collection, sessionId, limit) {
         const filter = { session_id: sessionId };
         const docs = await collection
           .find(filter)
           .sort({ created_at: 1, _id: 1 })
           .limit(limit)
           .toArray();
         return docs;
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags an array literal find with a member-expression predicate", () => {
    const result = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `const result = [{ x: 1 }].find(filters.isWanted).x;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat a bare findIndex result as a positive guard", () => {
    const result = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `function read(items, predicate) {
         if (items.findIndex(predicate)) return items.find(predicate).x;
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts an explicit non-negative findIndex guard", () => {
    const result = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `function read(items, predicate) {
         if (items.findIndex(predicate) !== -1) return items.find(predicate).x;
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not treat a false some result as a positive guard", () => {
    const result = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `function read(items, predicate) {
         if (items.some(predicate) === false) return items.find(predicate).x;
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat a negated some result as a positive guard", () => {
    const result = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `function read(items, predicate) {
         if (!items.some(predicate)) return items.find(predicate).x;
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not trust repeated find calls with a nondeterministic predicate", () => {
    const result = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `items.find(() => Math.random() > 0.5) && items.find(() => Math.random() > 0.5).x;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a custom find method reached through an object alias", () => {
    const result = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `const query = { find(callback) { return { x: 1 }; } };
       const alias = query;
       alias.find(callback).x;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags when an unrelated membership lookup does not dominate the dereference", () => {
    const result = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `const ProductList = ({ wishlist, products }) => {
         const removeItemFromWishlist = async (product) => {
           const itemId = wishlist.customerProductListItems.find(
             (i) => i.productId === product.productId
           ).id;
           await deleteItem(itemId);
         };
         return products.map((product) => {
           const isInWishlist = !!wishlist?.customerProductListItems?.find(
             (item) => item.productId === product.productId
           );
           return (
             <ProductTile
               key={product.productId}
               isFavourite={isInWishlist}
               onFavouriteToggle={() => removeItemFromWishlist(product)}
             />
           );
         });
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags the optional-receiver deref when no other lookup on the path exists (order-history TP)", () => {
    const result = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `const images = products?.map((product) => {
         return product?.imageGroups?.find((group) => group.viewType === 'small').images[0];
       });`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a deref in a non-JSX callback defined after the guard", () => {
    const result = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `function setup(items, id) {
         if (!items.find((item) => item.id === id)) return null;
         return () => items.find((item) => item.id === id).label;
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags an early-return guard over a different predicate", () => {
    const result = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `function label(items, id, other) {
         if (!items.find((item) => item.id === other)) return null;
         return items.find((item) => item.id === id).label;
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("analyzes hundreds of independent find calls without rescanning the module", () => {
    const statements = Array.from(
      { length: FIND_CALL_COUNT },
      (_, index) => `const value${index} = items.find((item) => item.id === ${index}).name;`,
    ).join("\n");
    const startTime = performance.now();
    const result = runRule(noArrayFindResultMemberAccessWithoutGuard, statements);
    const durationMs = performance.now() - startTime;

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(FIND_CALL_COUNT);
    expect(durationMs).toBeLessThan(MAX_ANALYSIS_DURATION_MS);
  });
});
