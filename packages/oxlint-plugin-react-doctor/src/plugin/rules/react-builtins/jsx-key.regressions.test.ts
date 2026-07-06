import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { jsxKey } from "./jsx-key.js";

const expectFail = (code: string): void => {
  const result = runRule(jsxKey, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics.length).toBeGreaterThan(0);
};

const expectPass = (code: string): void => {
  const result = runRule(jsxKey, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(0);
};

describe("react-builtins/jsx-key — regressions", () => {
  // A spread can only clobber an explicit `key` when it sits AFTER the key:
  // the later attribute wins under both the classic runtime (`{ key, ...spread }`)
  // and the automatic runtime (falls back to `createElement`). So we flag
  // key-before-spread and stay silent on key-after-spread.
  it("flags a spread placed after the key", () => expectFail(`[<App key="x" {...b} />];`));

  it("does not flag a key placed after every spread", () =>
    expectPass(`[<App {...b} key="x" />];`));

  // Sandwiched: a spread (`{...b}`) still comes after the key, so it can
  // overwrite it — keep flagging.
  it("flags key between two spreads", () => expectFail(`[<App {...a} key="x" {...b} />];`));

  it("does not flag a key after two leading spreads", () =>
    expectPass(`[<App {...a} {...b} key="x" />];`));

  // A spread of an object literal that provably carries no `key` cannot
  // overwrite the explicit one, even when written after it.
  it("does not flag an empty-object spread after the key", () =>
    expectPass(`<App key="x" {...{}} />;`));

  it("does not flag a keyless-object-literal spread after the key", () =>
    expectPass(`<App key="x" {...{ className: c }} />;`));

  it("flags an object-literal spread that carries a key", () =>
    expectFail(`<App key="x" {...{ key: y }} />;`));

  it("does not flag shorthand fragments returned from iterators", () => {
    expectPass(`items.map((item) => <>{item.name}</>);`);
  });

  it("does not flag shorthand fragments in array literals", () => {
    expectPass(`[<>one</>, <>two</>];`);
  });

  it("does not flag shorthand fragments even when the old explicit setting is present", () => {
    const result = runRule(jsxKey, `items.map((item) => <>{item.name}</>);`, {
      settings: { "react-doctor": { jsxKey: { checkFragmentShorthand: true } } },
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  // Stable id-spread: spreading the whole iteration item is the "row carries
  // its own identity" shape. We stay silent there but keep firing on genuine
  // keyless lists.
  it("does not flag a list element that spreads the iteration item", () => {
    expectPass(`items.map(item => <Item {...item} />);`);
  });

  it("does not flag a function-expression iterator spreading the item", () => {
    expectPass(`items.map(function (item) { return <Item {...item} />; });`);
  });

  it("does not flag Array.from spreading the item", () => {
    expectPass(`Array.from(items, (item) => <Item {...item} />);`);
  });

  it("still flags a keyless list element that does not spread the item", () => {
    expectFail(`items.map(item => <Item name={item.name} />);`);
  });

  it("still flags when spreading something other than the iteration item", () => {
    expectFail(`items.map(item => <Item {...other} />);`);
  });

  it("still flags an array-literal element that spreads an identifier", () => {
    expectFail(`[<Item {...item} />];`);
  });

  // Consumer-keys-internally: an element collection handed to a non-`children`
  // prop is the receiving component's responsibility to key. React only
  // key-validates `props.children`, so flagging the producer site is noise.
  it("does not flag an array literal passed to a non-children prop", () => {
    expectPass(`<Tabs items={[<Tab />, <Tab />]} />;`);
  });

  it("does not flag a mapped collection passed to a non-children prop", () => {
    expectPass(`<Menu items={data.map((d) => <MenuItem label={d.label} />)} />;`);
  });

  it("does not flag an optional-chained mapped collection in a prop", () => {
    expectPass(`<Menu items={data?.map((d) => <MenuItem label={d.label} />)} />;`);
  });

  it("does not flag Array.from elements passed to a non-children prop", () => {
    expectPass(`<Grid cells={Array.from(rows, (row) => <Cell value={row} />)} />;`);
  });

  it("still flags an array literal in children position", () => {
    expectFail(`<Tabs>{[<Tab />, <Tab />]}</Tabs>;`);
  });

  it("still flags a mapped collection in children position", () => {
    expectFail(`<Menu>{data.map((d) => <MenuItem label={d.label} />)}</Menu>;`);
  });

  it("still flags an array literal passed via the explicit children attribute", () => {
    // `children={[...]}` IS `props.children`, which React does validate.
    expectFail(`<Tabs children={[<Tab />, <Tab />]} />;`);
  });

  it("still flags a DOM element array in children position", () => {
    expectFail(`<ul>{[<li />, <li />]}</ul>;`);
  });

  // Wrappers that pass the value straight through to the prop (`&&`, `||`,
  // ternary branches, parens, TS assertions) don't change that React never
  // key-validates a non-children prop, so they're exempt too.
  it("does not flag a logical-wrapped mapped collection in a prop", () => {
    expectPass(`<Menu items={data.length && data.map((d) => <MenuItem v={d} />)} />;`);
  });

  it("does not flag a ternary-branch mapped collection in a prop", () => {
    expectPass(`<Menu items={ready ? data.map((d) => <MenuItem v={d} />) : []} />;`);
  });

  it("does not flag a TS-asserted array literal in a prop", () => {
    expectPass(`<Menu items={[<Tab />, <Tab />] as ReactNode[]} />;`);
  });

  it("still flags a logical-wrapped mapped collection in children position", () => {
    expectFail(`<Menu>{data.length && data.map((d) => <MenuItem v={d} />)}</Menu>;`);
  });

  // tim-soft/react-spring-lightbox ImagePager: a `{...bind()}`
  // gesture spread BEFORE the explicit key is safe — the key wins — so the
  // base shape stays silent; moving the key ABOVE the spread (the old oracle
  // "fix") is what lets the spread clobber it, so that order fires.
  it("does not flag the tim-soft base shape: gesture spread before key in a map", () => {
    expectPass(`
      pagerSprings.map(({ display, x }, i) => (
        <AnimatedImagePager
          $inline={inline}
          {...bind()}
          className="lightbox-image-pager"
          key={i}
          role="presentation"
        />
      ));
    `);
  });

  it("does not flag the corrected tim-soft fix: stable key kept after the gesture spread", () => {
    expectPass(`
      pagerSprings.map(({ display, x }, i) => (
        <AnimatedImagePager
          $inline={inline}
          {...bind()}
          className="lightbox-image-pager"
          key={images[i].src}
          role="presentation"
        />
      ));
    `);
  });

  it("flags the inverted tim-soft oracle shape: key placed before the gesture spread", () => {
    expectFail(`
      pagerSprings.map(({ display, x }, i) => (
        <AnimatedImagePager
          key={images[i].src}
          $inline={inline}
          {...bind()}
          className="lightbox-image-pager"
          role="presentation"
        />
      ));
    `);
  });

  // cloudscape property-filter permutations: the spread resolves to a local
  // `const` object literal that provably carries no `key`, so it cannot
  // overwrite the explicit one.
  it("does not flag a spread of a keyless local const object literal after the key", () => {
    expectPass(`
      const tokenProps = { text: "token", onDismiss: () => {} };
      const App = () => (
        <div>
          {[
            <Token key="1" {...tokenProps} />,
            <Token key="2" {...tokenProps} />,
          ]}
        </div>
      );
    `);
  });

  it("flags a spread of a local const object literal that carries a key", () => {
    expectFail(`
      const withKey = { key: "boom", text: "token" };
      items.map((item) => <Token key={item.id} {...withKey} />);
    `);
  });

  it("flags a spread of a const object literal mutated via Object.assign", () => {
    expectFail(`
      const common = { text: "token" };
      Object.assign(common, extra);
      items.map((item) => <Token key={item.id} {...common} />);
    `);
  });

  it("flags a spread of a const object literal mutated via member assignment", () => {
    expectFail(`
      const common = { text: "token" };
      common.key = "boom";
      items.map((item) => <Token key={item.id} {...common} />);
    `);
  });

  // nexu-io PreviewModal: `{...(item.testId ? { 'data-testid': item.testId } : {})}`
  // — both branches are provably keyless literals.
  it("does not flag a conditional spread whose branches are keyless literals", () => {
    expectPass(`
      items.map((item) => (
        <li key={item.id} {...(item.testId ? { "data-testid": item.testId } : {})} />
      ));
    `);
  });

  it("flags a conditional spread with an unprovable call branch", () => {
    expectFail(`
      items.map((item, i) => (
        <li key={i} {...(item.disabled ? {} : getAnalyticsAttributes(item))} />
      ));
    `);
  });

  it("does not flag a logical-and spread whose object side is keyless", () => {
    expectPass(`items.map((item) => <li key={item.id} {...(item.wide && { colSpan: 2 })} />);`);
  });

  // React strips `key` before props reach a class component, so
  // `{...this.props}` can never overwrite an explicit key.
  it("does not flag a this.props spread after the key", () => {
    expectPass(`
      class Dropdown extends Component {
        render() {
          return [<Menu key="dropdown" {...this.props} />];
        }
      }
    `);
  });

  it("does not flag a rest spread whose pattern destructured the key away", () => {
    expectPass(`
      const Row = (rowInput) => {
        const { key, ...rest } = rowInput;
        return items.map((item) => <li key={item.id} {...rest} />);
      };
    `);
  });

  it("flags a rest spread whose pattern did not extract the key", () => {
    expectFail(`
      const Row = (rowInput) => {
        const { label, ...rest } = rowInput;
        return items.map((item) => <li key={item.id} {...rest} />);
      };
    `);
  });

  // catho-quantum test fixtures: a JSX array bound to a variable that is
  // only consumed element-by-element (forEach + render, positional lookup,
  // re-wrapped in keyed elements) never renders the raw elements as
  // siblings, so their keys are inert.
  it("does not flag a fixture array iterated with forEach and rendered one at a time", () => {
    expectPass(`
      const INPUTS = [<TextInput label="a" />, <TextInput label="b" />];
      INPUTS.forEach((input) => {
        render(input);
      });
    `);
  });

  it("does not flag a positional lookup array rendered one element at a time", () => {
    expectPass(`
      const icons = [<IconA />, <IconB />];
      const Card = ({ index }) => <div>{icons[index]}</div>;
    `);
  });

  it("does not flag an element array re-wrapped in keyed elements via map", () => {
    expectPass(`
      const exampleIcons = [<Icon name="a" />, <Icon name="b" />];
      export const Examples = () =>
        exampleIcons.map((icon, index) => <Wrapper key={index}>{icon}</Wrapper>);
    `);
  });

  it("still flags a variable-bound array rendered directly as children", () => {
    expectFail(`
      const badges = [<Badge type="a" />, <Badge type="b" />];
      const App = () => <div>{badges}</div>;
    `);
  });

  it("still flags a variable-bound array rendered through an identity map", () => {
    expectFail(`
      const badges = [<Badge type="a" />, <Badge type="b" />];
      const App = () => <div>{badges.map((badge) => badge)}</div>;
    `);
  });

  it("still flags an array literal returned straight from a function", () => {
    expectFail(`
      export const carouselNodes = () => {
        return [<Slide id={1} />, <Slide id={2} />];
      };
    `);
  });

  // react-table v7 / MUI / prism prop getters deliver the key through the
  // returned props object, so a call-expression spread makes "missing key"
  // unprovable.
  it("does not flag a list element keyed through a prop-getter call spread", () => {
    expectPass(`
      headerGroups.map((headerGroup) => (
        <tr {...headerGroup.getHeaderGroupProps()}>
          {headerGroup.headers.map((column) => (
            <th {...column.getHeaderProps()}>{column.render("Header")}</th>
          ))}
        </tr>
      ));
    `);
  });

  it("does not flag a MUI getTagProps call spread in a map", () => {
    expectPass(`tags.map((tag, index) => <Chip {...getTagProps({ index })} label={tag} />);`);
  });
});
