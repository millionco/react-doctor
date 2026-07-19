import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { jsxNumericAndLeakedRender } from "./jsx-numeric-and-leaked-render.js";

describe("jsx-numeric-and-leaked-render", () => {
  it("flags {items.length && <List/>}", () => {
    const result = runRule(
      jsxNumericAndLeakedRender,
      `const C = ({ items }) => <div>{items.length && <List items={items} />}</div>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a parenthesized JSX right operand {cart.items.length && (<Summary/>)}", () => {
    const result = runRule(
      jsxNumericAndLeakedRender,
      `const C = ({ cart }) => <div>{cart.items.length && (<Summary />)}</div>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags .size on a binding provably initialized to a Set", () => {
    const result = runRule(
      jsxNumericAndLeakedRender,
      `const C = ({ ids }) => {
        const selected = new Set(ids);
        return <div>{selected.size && <Badge />}</div>;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags .size on a useState(new Set()) destructure", () => {
    const result = runRule(
      jsxNumericAndLeakedRender,
      `const C = () => {
        const [selected, setSelected] = useState(new Set());
        return <div>{selected.size && <Badge />}</div>;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags .size on a useRef(new Map()) current", () => {
    const result = runRule(
      jsxNumericAndLeakedRender,
      `const C = () => {
        const cacheRef = useRef(new Map());
        return <div>{cacheRef.current.size && <Badge />}</div>;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags {(count - 1) && <More/>}", () => {
    const result = runRule(
      jsxNumericAndLeakedRender,
      `const C = ({ count }) => <div>{(count - 1) && <More />}</div>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags {Number(value) && <Chip/>}", () => {
    const result = runRule(
      jsxNumericAndLeakedRender,
      `const C = ({ value }) => <div>{Number(value) && <Chip />}</div>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags the JSX-adjacent .length in a chain {!isLoading && items.length && <X/>}", () => {
    const result = runRule(
      jsxNumericAndLeakedRender,
      `const C = ({ isLoading, items }) => <div>{!isLoading && items.length && <List />}</div>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a numeric operand earlier in the chain {items.length && isOpen && <List/>}", () => {
    const result = runRule(
      jsxNumericAndLeakedRender,
      `const C = ({ items, isOpen }) => <div>{items.length && isOpen && <List />}</div>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags numeric && inside a ternary branch {ready ? items.length && <List/> : <Spinner/>}", () => {
    const result = runRule(
      jsxNumericAndLeakedRender,
      `const C = ({ ready, items }) => <div>{ready ? items.length && <List /> : <Spinner />}</div>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags numeric && in the right arm of || {empty || (items.length && <List/>)}", () => {
    const result = runRule(
      jsxNumericAndLeakedRender,
      `const C = ({ empty, items }) => <div>{empty || (items.length && <List />)}</div>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags {items.length && items.map(i => <Item/>)}", () => {
    const result = runRule(
      jsxNumericAndLeakedRender,
      `const C = ({ items }) => <ul>{items.length && items.map((i) => <Item key={i.id} />)}</ul>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag react-hook-form errors.size (FieldError for a field named size)", () => {
    const result = runRule(
      jsxNumericAndLeakedRender,
      `const C = ({ errors }) => <div>{errors.size && <FieldError message={errors.size.message} />}</div>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a string size prop {props.size && <SizeBadge/>}", () => {
    const result = runRule(
      jsxNumericAndLeakedRender,
      `const C = (props) => <div>{props.size && <SizeBadge size={props.size} />}</div>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag .size on a bare prop with no provable Map/Set origin", () => {
    const result = runRule(
      jsxNumericAndLeakedRender,
      `const C = ({ selected }) => <div>{selected.size && <Badge />}</div>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a boolean LHS {isOpen && <Modal/>}", () => {
    const result = runRule(
      jsxNumericAndLeakedRender,
      `const C = ({ isOpen }) => <div>{isOpen && <Modal />}</div>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a comparison {arr.length > 0 && <X/>}", () => {
    const result = runRule(
      jsxNumericAndLeakedRender,
      `const C = ({ arr }) => <div>{arr.length > 0 && <X />}</div>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag inequality {items.length !== 0 && <X/>}", () => {
    const result = runRule(
      jsxNumericAndLeakedRender,
      `const C = ({ items }) => <div>{items.length !== 0 && <X />}</div>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a double-negation {!!arr.length && <X/>}", () => {
    const result = runRule(
      jsxNumericAndLeakedRender,
      `const C = ({ arr }) => <div>{!!arr.length && <X />}</div>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a ternary {arr.length ? <X/> : null}", () => {
    const result = runRule(
      jsxNumericAndLeakedRender,
      `const C = ({ arr }) => <div>{arr.length ? <X /> : null}</div>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a string/identifier LHS {name && <X/>}", () => {
    const result = runRule(
      jsxNumericAndLeakedRender,
      `const C = ({ name }) => <div>{name && <X />}</div>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a numeric && used as an attribute value", () => {
    const result = runRule(
      jsxNumericAndLeakedRender,
      `const C = ({ items }) => <X hidden={items.length && <Y />} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag the left arm of || where a falsy 0 never renders {(items.length && <List/>) || <Empty/>}", () => {
    const result = runRule(
      jsxNumericAndLeakedRender,
      `const C = ({ items }) => <div>{(items.length && <List />) || <Empty />}</div>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a map call whose callback renders no JSX {count && names.map(n => n.toUpperCase())}", () => {
    const result = runRule(
      jsxNumericAndLeakedRender,
      `const total = ({ count, names }) => count && names.map((n) => n.toUpperCase());`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet on react-hook-form errors.length whose render side reads errors.length.message", () => {
    const result = runRule(
      jsxNumericAndLeakedRender,
      `const DimensionsForm = () => {
         const { register, formState: { errors } } = useForm();
         return (
           <form>
             <input {...register("length", { required: "Length is required" })} />
             {errors.length && <p className="error">{errors.length.message}</p>}
           </form>
         );
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet on a length property typed string by an in-file interface", () => {
    const result = runRule(
      jsxNumericAndLeakedRender,
      `interface Track { title: string; length: string }
       const TrackRow = ({ track }: { track: Track }) => (
         <tr>
           <td>{track.title}</td>
           <td>{track.length && <Duration label={track.length} />}</td>
         </tr>
       );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags array length even when an in-file interface types an unrelated receiver", () => {
    const result = runRule(
      jsxNumericAndLeakedRender,
      `interface Track { length: string }
       const List = ({ items }) => <div>{items.length && <ul>{items.map((i) => <li key={i} />)}</ul>}</div>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet when a dominating operand proves the length positive (cloudscape tree-item shape)", () => {
    const result = runRule(
      jsxNumericAndLeakedRender,
      `const TreeItem = ({ item, expandedItems, getItemChildren, id }) => {
        const children = getItemChildren(item) || [];
        const isExpandable = children.length > 0;
        const isExpanded = isExpandable && expandedItems.includes(id);
        return (
          <li>
            {isExpanded && children.length && (
              <ul>
                {children.map((child) => (
                  <TreeItem key={child.id} item={child} />
                ))}
              </ul>
            )}
          </li>
        );
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags when the dominating operand does not constrain the count", () => {
    const result = runRule(
      jsxNumericAndLeakedRender,
      `const TreeItem = ({ children, isSelected }) => (
        <li>{isSelected && children.length && <ul>{children.map((c) => <li key={c} />)}</ul>}</li>
      );`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet on a never-set useState array seeded non-empty (docusaurus features shape)", () => {
    const result = runRule(
      jsxNumericAndLeakedRender,
      `const Home = () => {
        const [features, setFeatures] = useState([{ id: 1 }, { id: 2 }]);
        return (
          <main>
            {features && features.length && (
              <section>
                {features.map((feature) => (
                  <Feature key={feature.id} {...feature} />
                ))}
              </section>
            )}
          </main>
        );
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a useState array whose setter is called (the list can become empty)", () => {
    const result = runRule(
      jsxNumericAndLeakedRender,
      `const Home = () => {
        const [features, setFeatures] = useState([{ id: 1 }]);
        return (
          <main>
            <button onClick={() => setFeatures([])}>clear</button>
            {features.length && <section>{features.map((f) => <Feature key={f.id} />)}</section>}
          </main>
        );
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a useState array seeded empty even when the setter is never called", () => {
    const result = runRule(
      jsxNumericAndLeakedRender,
      `const Home = () => {
        const [features, setFeatures] = useState([]);
        return <main>{features.length && <section>{features.map((f) => <Feature key={f} />)}</section>}</main>;
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet when the receiver is provably non-empty-or-undefined (remix-forms globalErrorsToDisplay shape)", () => {
    const result = runRule(
      jsxNumericAndLeakedRender,
      `const SchemaForm = ({ errors, navigationState }) => {
        const toGlobal = React.useCallback((incoming) => {
          const all = [].concat(incoming).filter((error) => typeof error === 'string');
          return all.length > 0 ? all : undefined;
        }, []);
        const globalErrors = React.useMemo(() => toGlobal(errors), [errors, toGlobal]);
        const globalErrorsToDisplay = navigationState !== 'idle' ? undefined : globalErrors;
        return (
          <form>
            {globalErrorsToDisplay?.length && (
              <Errors>
                {globalErrorsToDisplay.map((error) => (
                  <Error key={error}>{error}</Error>
                ))}
              </Errors>
            )}
          </form>
        );
      };`,
      { filename: "schema-form.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags an optional-chained length on a plain array prop (vip-design-system Footer shape)", () => {
    const result = runRule(
      jsxNumericAndLeakedRender,
      `const Footer = ({ links }) => (
        <footer>
          {links?.length && (
            <ul>
              {links.map((link) => (
                <li key={link.href}>{link.label}</li>
              ))}
            </ul>
          )}
        </footer>
      );`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a numeric && wrapped by ?? (0 is not nullish, so it still leaks)", () => {
    const result = runRule(
      jsxNumericAndLeakedRender,
      `const List = ({ items, fallback }) => (
        <div>{(items.length && <Rows items={items} />) ?? fallback}</div>
      );`,
      { filename: "list.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a numeric && swallowed by the left arm of ||", () => {
    const result = runRule(
      jsxNumericAndLeakedRender,
      `const List = ({ items, fallback }) => (
        <div>{(items.length && <Rows items={items} />) || fallback}</div>
      );`,
      { filename: "list.tsx" },
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});

describe("audit regressions", () => {
  it("does not treat a shadowed Number helper as numeric coercion", () => {
    const result = runRule(
      jsxNumericAndLeakedRender,
      `const Number = (value) => Boolean(value); const C = ({ value }) => <div>{Number(value) && <Chip />}</div>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not classify string concatenation as numeric", () => {
    const result = runRule(
      jsxNumericAndLeakedRender,
      `const C = ({ label }) => <>{"prefix" + label && <X />}</>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not trust a reassigned positive-guard alias", () => {
    const result = runRule(
      jsxNumericAndLeakedRender,
      `const C = ({ items }) => { let hasItems = items.length > 0; hasItems = true; return <>{hasItems && items.length && <X />}</>; };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not mistake number prototype reads for object evidence", () => {
    const result = runRule(
      jsxNumericAndLeakedRender,
      `const C = ({ items }) => <>{items.length && <X>{items.length.toString()}</X>}</>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
