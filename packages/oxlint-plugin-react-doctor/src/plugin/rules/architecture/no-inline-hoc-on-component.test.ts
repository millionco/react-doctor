import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noInlineHocOnComponent } from "./no-inline-hoc-on-component.js";

describe("no-inline-hoc-on-component", () => {
  it("flags an inline hook-calling arrow passed to a tracking HOC", () => {
    const result = runRule(
      noInlineHocOnComponent,
      `const Header = withTracking((props) => {
        const [open, setOpen] = useState(false);
        return <h1 onClick={() => setOpen(!open)}>{props.store.title}</h1>;
      });`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an inline hook-calling function expression passed to withRouter", () => {
    const result = runRule(
      noInlineHocOnComponent,
      `const Page = withRouter(function (props) {
        useEffect(() => trackVisit(props.location), [props.location]);
        return <div>{props.location.pathname}</div>;
      });`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a lowercase-named hook-calling function expression, which rules-of-hooks skips", () => {
    const result = runRule(
      noInlineHocOnComponent,
      `const Page = withRouter(function pageBase(props) {
        const theme = useTheme();
        return <div className={theme}>{props.location.pathname}</div>;
      });`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a curried HOC call assigned to a component binding", () => {
    const result = runRule(
      noInlineHocOnComponent,
      `export const Card = connect(mapState)((props) => (
        <article>{useFormatted(props.title)}</article>
      ));`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a hook-calling inline component exported as default", () => {
    const result = runRule(
      noInlineHocOnComponent,
      `export default withTheme((props) => {
        const [count] = useState(0);
        return <h1>{props.store.title}{count}</h1>;
      });`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an inline HOC component nested inside a memo composition", () => {
    const result = runRule(
      noInlineHocOnComponent,
      `const Card = memo(withTheme((props) => {
        const label = useLabel(props);
        return <div>{props.theme.color}{label}</div>;
      }));`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an inline HOC component nested inside an observer composition", () => {
    const result = runRule(
      noInlineHocOnComponent,
      "const Card = observer(withTheme(() => { useTheme(); return <div />; }));",
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an inline HOC component whose result is cast before the binding", () => {
    const result = runRule(
      noInlineHocOnComponent,
      `const Card = withTheme((props) => <div>{useColor(props.theme)}</div>) as React.FC;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an inline HOC component threaded through a curried outer HOC call", () => {
    const result = runRule(
      noInlineHocOnComponent,
      `export const Page = connect(mapState)(withRouter((props) => {
        const query = useQuery(props.location);
        return <div>{query.data}</div>;
      }));`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a hook-free inline component threaded through a curried outer HOC call", () => {
    const result = runRule(
      noInlineHocOnComponent,
      `export const Page = connect(mapState)(withRouter((props) => (
        <div>{props.location.pathname}</div>
      )));`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags an inline HOC component cast inside the call parentheses", () => {
    const result = runRule(
      noInlineHocOnComponent,
      `const Header = withTheme(((props) => <h1>{useTitle(props)}</h1>) as React.FC<Props>);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a real HOC whose name merely contains but does not end in factory", () => {
    const result = runRule(
      noInlineHocOnComponent,
      `export const Container = createFactoryBackedHoc((props) => {
        const data = useFragmentData(props);
        return <section>{data.children}</section>;
      });`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag Relay container creators (createRefetchContainer API shape)", () => {
    const result = runRule(
      noInlineHocOnComponent,
      `export const Container = createRefetchContainer((props) => {
        const data = useFragmentData(props);
        return <section>{data.children}</section>;
      }, fragmentSpec, query);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags unrelated create-container HOCs", () => {
    const result = runRule(
      noInlineHocOnComponent,
      `export const Container = createAuthContainer((props) => {
        const user = useUser();
        return <section>{user.name}{props.children}</section>;
      });`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag react-tracking's curried track()(Component) form", () => {
    const result = runRule(
      noInlineHocOnComponent,
      `export const NavBar = track()((props) => {
        const [open, setOpen] = useState(false);
        return <nav onClick={() => setOpen(!open)}>{props.title}</nav>;
      });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a hook-free inline function passed to a classic HOC (react-sortable-hoc idiom)", () => {
    const result = runRule(
      noInlineHocOnComponent,
      `const SortableItem = SortableElement((props) => <li>{props.value}</li>);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a hook-free instantsearch connector component", () => {
    const result = runRule(
      noInlineHocOnComponent,
      `const CurrentRefinements = connectCurrentRefinements(({ items, refine }) => (
        <ul>{items.map((item) => <li key={item.label} onClick={() => refine(item.value)}>{item.label}</li>)}</ul>
      ));`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a hook-calling anonymous arrow passed to observer (canonical mobx-react-lite component form)", () => {
    const result = runRule(
      noInlineHocOnComponent,
      `const Timer = observer(() => {
        const [tick, setTick] = useState(0);
        useEffect(() => { const id = setInterval(() => setTick((t) => t + 1), 1000); return () => clearInterval(id); }, []);
        return <div>{tick}</div>;
      });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a hook-free inline observer component (classic pre-hooks HOC form)", () => {
    const result = runRule(
      noInlineHocOnComponent,
      `const TimerView = observer(function TimerView(props) {
        return <span>{props.timer.secondsPassed}</span>;
      });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a named hook-calling function expression (MobX docs' observer fix)", () => {
    const result = runRule(
      noInlineHocOnComponent,
      `const TimerView = observer(function TimerView(props) {
        const seconds = useElapsedSeconds(props.timer);
        return <span>{seconds}</span>;
      });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag Mantine's factory component primitive", () => {
    const result = runRule(
      noInlineHocOnComponent,
      `export const AreaChart = factory<AreaChartFactory>((_props) => {
        return <div>{_props.title}</div>;
      });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag Mantine's polymorphicFactory component primitive", () => {
    const result = runRule(
      noInlineHocOnComponent,
      `export const Badge = polymorphicFactory<BadgeFactory>((_props) => <span>{_props.label}</span>);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag the extracted-reference form", () => {
    const result = runRule(
      noInlineHocOnComponent,
      `const ComponentBase = (props) => <div>{useContent(props)}</div>;
       const Component = hoc(ComponentBase);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a useCallback render callback", () => {
    const result = runRule(
      noInlineHocOnComponent,
      `const renderRow = useCallback(() => <Row />, []);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a useMemo render callback", () => {
    const result = runRule(noInlineHocOnComponent, `const RenderRow = useMemo(() => <Row />, []);`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag forwardRef", () => {
    const result = runRule(
      noInlineHocOnComponent,
      `export const Squared = forwardRef((props, ref) => (
        <div ref={ref} {...props} />
      ));`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag memo", () => {
    const result = runRule(
      noInlineHocOnComponent,
      `const Card = memo((props) => <article>{props.title}</article>);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag styled factory calls", () => {
    const result = runRule(
      noInlineHocOnComponent,
      `export const Img = styled((props) => <img alt="" {...props} />)\`\`;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a map iteration callback", () => {
    const result = runRule(
      noInlineHocOnComponent,
      `const list = items.map((it) => <Row key={it.id} item={it} />);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a member-callee helper handed an inline JSX function", () => {
    const result = runRule(
      noInlineHocOnComponent,
      `const Rendered = lib.render((props) => <div {...props} />);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a class render method", () => {
    const result = runRule(
      noInlineHocOnComponent,
      `class Panel {
        render() {
          return <Test />;
        }
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a wrapper whose inline function has no JSX", () => {
    const result = runRule(noInlineHocOnComponent, `const sum = wrap((a, b) => a + b);`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an HOC result assigned to a lowercase binding", () => {
    const result = runRule(
      noInlineHocOnComponent,
      `const rendered = act((props) => <div {...props} />);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not treat a dynamic uppercase member key as a component assignment", () => {
    const result = runRule(
      noInlineHocOnComponent,
      `registry[Component] = withTheme((props) => {
        useTheme();
        return <div>{props.children}</div>;
      });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a function that only renders JSX in a nested non-returned callback", () => {
    const result = runRule(
      noInlineHocOnComponent,
      `const Wrapped = wrapData((rows) => {
        rows.forEach((row) => <Cell value={row} />);
        return rows.length;
      });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    ["an array map callback", `items.map((item) => <Row key={item.id} item={item} />)`],
    ["an optional array map callback", `items?.map((item) => <Row key={item.id} item={item} />)`],
    [
      "an array flatMap callback with a block body",
      `items.flatMap((item) => {
        if (!item.visible) return [];
        return [<Row key={item.id} item={item} />];
      })`,
    ],
    [
      "an optional array flatMap callback",
      `items?.flatMap((item) => [<Row key={item.id} item={item} />])`,
    ],
    [
      "a global Array.from mapper",
      `Array.from(items, (item) => <Row key={item.id} item={item} />)`,
    ],
  ])("flags JSX returned through %s", (_name, returnedExpression) => {
    const result = runRule(
      noInlineHocOnComponent,
      `const Rows = withTracking(({ items }) => {
        useRows(items);
        return ${returnedExpression};
      });`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags JSX returned through an imported useMemo callback", () => {
    const result = runRule(
      noInlineHocOnComponent,
      `import { useMemo } from "react";
      const Rows = withTracking(({ items }) => {
        useRows(items);
        return useMemo(() => <RowList items={items} />, [items]);
      });`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags JSX returned through a global React.useMemo callback", () => {
    const result = runRule(
      noInlineHocOnComponent,
      `const Rows = withTracking(({ items }) => {
        React.useState(items);
        return React.useMemo(() => <RowList items={items} />, [items]);
      });`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat a shadowed useMemo callback as React render output", () => {
    const result = runRule(
      noInlineHocOnComponent,
      `const useMemo = (callback) => ({ callback });
      const Rows = withTracking(({ items }) => {
        useRows(items);
        return useMemo(() => <RowList items={items} />, [items]);
      });`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not treat a shadowed React.useMemo callback as React render output", () => {
    const result = runRule(
      noInlineHocOnComponent,
      `const React = {
        useMemo: (callback) => ({ callback }),
        useState: (value) => value,
      };
      const Rows = withTracking(({ items }) => {
        React.useState(items);
        return React.useMemo(() => <RowList items={items} />, [items]);
      });`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    ["forEach", `items.forEach((item) => <Row key={item.id} item={item} />)`],
    ["filter", `items.filter((item) => <Row key={item.id} item={item} />)`],
    ["a deferred promise", `loadItems().then((item) => <Row key={item.id} item={item} />)`],
    ["a returned render closure", `items.map((item) => () => <Row item={item} />)`],
    [
      "discarded JSX in a map callback",
      `items.map((item) => {
        const preview = <Row item={item} />;
        return item.id;
      })`,
    ],
  ])("does not treat JSX inside %s as the component return value", (_name, returnedExpression) => {
    const result = runRule(
      noInlineHocOnComponent,
      `const Rows = withTracking(({ items }) => {
        useRows(items);
        return ${returnedExpression};
      });`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an expression-body data callback whose JSX lives only in a nested closure", () => {
    const result = runRule(
      noInlineHocOnComponent,
      `const Wrapped = wrapData((rows) => useProcessed(rows).forEach((row) => <Cell value={row} />));`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a hook-calling config factory that returns a render closure, not JSX", () => {
    const result = runRule(
      noInlineHocOnComponent,
      `const Modal = createModal((props) => {
        const state = useModalState(props);
        return { render: () => <Dialog state={state} /> };
      });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not treat a markdown-it .use(plugin) chain as a hook call inside a hook-free classic HOC", () => {
    const result = runRule(
      noInlineHocOnComponent,
      `const SortableItem = sortableElement((props) => {
        const renderer = markdownIt().use(taskLists).use(anchors);
        return <li dangerouslySetInnerHTML={{ __html: renderer.render(props.text) }} />;
      });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not treat a unified().use() pipeline as hook calls inside a hook-free withRouter component", () => {
    const result = runRule(
      noInlineHocOnComponent,
      `const Article = withRouter((props) => {
        const html = unified().use(remarkParse).use(remarkHtml).processSync(props.body);
        return <article dangerouslySetInnerHTML={{ __html: String(html) }} />;
      });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still counts React.useState namespace calls as hooks inside an inline HOC component", () => {
    const result = runRule(
      noInlineHocOnComponent,
      `const Panel = withTracking((props) => {
        const [open, setOpen] = React.useState(false);
        return <div onClick={() => setOpen(!open)}>{props.title}</div>;
      });`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("counts static computed React hook calls", () => {
    const result = runRule(
      noInlineHocOnComponent,
      `const Panel = withTracking((props) => {
        const [open, setOpen] = React["useState"](false);
        return <div onClick={() => setOpen(!open)}>{props.title}</div>;
      });`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags JSX returned through a local const binding", () => {
    const result = runRule(
      noInlineHocOnComponent,
      `const Page = withTheme((props) => {
        useTheme();
        const content = props.compact ? <span /> : <div />;
        return content;
      });`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags JSX returned through an unchanged local let binding", () => {
    const result = runRule(
      noInlineHocOnComponent,
      `const Page = withTheme((props) => {
        useTheme();
        let content = props.compact ? <span /> : <div />;
        return content;
      });`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not resolve a reassigned local let binding", () => {
    const result = runRule(
      noInlineHocOnComponent,
      `const Page = withTheme((props) => {
        useTheme();
        let content = <div />;
        content = props.fallback;
        return content;
      });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags inline components passed through optional HOC calls", () => {
    const result = runRule(
      noInlineHocOnComponent,
      `const Page = withTheme?.((props) => {
        useTheme();
        return <div>{props.children}</div>;
      });`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a typed polymorphic forwardRef wrapper taking the implementation inline", () => {
    const result = runRule(
      noInlineHocOnComponent,
      `const AnimateEmojiProvider = polymorphicForwardRef((props, ref) => {
        const [hovered, setHovered] = useState(false);
        return <div ref={ref} onMouseEnter={() => setHovered(true)}>{props.children}</div>;
      });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a typedMemo wrapper taking the implementation inline", () => {
    const result = runRule(
      noInlineHocOnComponent,
      `const Row = typedMemo((props) => {
        const formatted = useFormatted(props.value);
        return <td>{formatted}</td>;
      });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags withMemo-like HOCs instead of treating every memo suffix as a primitive", () => {
    const result = runRule(
      noInlineHocOnComponent,
      `const Row = withMemo((props) => {
        const formatted = useFormatted(props.value);
        return <td>{formatted}</td>;
      });`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat a shadowed React object as hook provenance", () => {
    const result = runRule(
      noInlineHocOnComponent,
      `const React = { useState: () => [false] };
       const Card = withTracking(() => {
         const [active] = React.useState(false);
         return <div>{active}</div>;
       });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
