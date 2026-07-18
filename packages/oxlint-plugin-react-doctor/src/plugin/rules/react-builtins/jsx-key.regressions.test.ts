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
  it("flags a key before a spread that provably carries one", () =>
    expectFail(`const props = { key: "spread" }; [<App key="x" {...props} />];`));

  it("does not flag a key placed after the spread", () => expectPass(`[<App {...b} key="x" />];`));

  it("stays silent on the reported props-spread shape", () =>
    expectPass(`<App {...props} key="blah" />;`));

  it("does not flag a key before direct component props", () => {
    expectPass(`const Row = (props) => <Item key="row" {...props} />;`);
  });

  it("does not flag a key before defaulted component props", () => {
    expectPass(`const Row = (props = {}) => <Item key="row" {...props} />;`);
  });

  it("does not flag a key before props in a named component", () => {
    expectPass(`function Row(props) { return <Item key="row" {...props} />; }`);
  });

  it("does not flag a key before props in a wrapped component", () => {
    expectPass(
      `const Row = memo(forwardRef((props, ref) => <Item key="row" ref={ref} {...props} />));`,
    );
  });

  it("does not guess that an ordinary helper parameter carries a key", () => {
    expectPass(`const renderRow = (props) => <Item key="row" {...props} />;`);
  });

  it("does not guess that an iterator parameter carries a key", () => {
    expectPass(
      `const items = [{ id: 1 }]; items.map((props, index) => <Item key={index} {...props} />);`,
    );
  });

  it("does not flag JSX arrays passed to non-rendering APIs", () => {
    expectPass(`editor.createShapesFromJsx([<Shape id="one" />, <Shape id="two" />]);`);
  });

  it("flags keyless JSX arrays passed to rendering APIs", () => {
    expectFail(`root.render([<Item value="one" />, <Item value="two" />]);`);
  });

  it("flags keyless JSX arrays passed as React.createElement children", () => {
    expectFail(`
      import React from "react";
      React.createElement(List, null, [<Item value="one" />, <Item value="two" />]);
    `);
  });

  it("flags keyless JSX arrays passed as imported createElement children", () => {
    expectFail(`
      import { createElement } from "react";
      createElement(List, null, [<Item value="one" />, <Item value="two" />]);
    `);
  });

  it("flags keyless JSX arrays passed as aliased createElement children", () => {
    expectFail(`
      import { createElement as h } from "react";
      h(List, null, [<Item value="one" />, <Item value="two" />]);
    `);
  });

  it("flags keyless JSX arrays passed through a React namespace alias", () => {
    expectFail(`
      import * as ReactRuntime from "react";
      ReactRuntime.createElement(List, null, [<Item value="one" />, <Item value="two" />]);
    `);
  });

  it("flags keyless JSX arrays passed as unbound createElement children", () => {
    expectFail(`createElement(List, null, [<Item value="one" />, <Item value="two" />]);`);
  });

  it("does not treat unrelated createElement calls as rendering APIs", () => {
    expectPass(`factory.createElement(List, null, [<Item value="one" />, <Item value="two" />]);`);
  });

  it("does not treat non-React createElement imports as rendering APIs", () => {
    expectPass(`
      import { createElement } from "widget-factory";
      createElement(List, null, [<Item value="one" />, <Item value="two" />]);
    `);
  });

  it("does not treat shadowed createElement bindings as rendering APIs", () => {
    expectPass(`
      const createElement = factory.createElement;
      createElement(List, null, [<Item value="one" />, <Item value="two" />]);
    `);
  });

  it("does not analyze JSX arrays used as createElement props", () => {
    expectPass(`
      import { createElement } from "react";
      createElement(List, [<Item value="one" />, <Item value="two" />]);
    `);
  });

  it("does not analyze JSX arrays used as the createElement element type", () => {
    expectPass(`
      import React from "react";
      React.createElement([<Item value="one" />, <Item value="two" />], null);
    `);
  });

  it("does not guess that a destructured component field carries a key", () => {
    expectPass(`const Row = ({ options }) => <Item key="row" {...options} />;`);
  });

  it("flags key between spreads when a later spread provably carries one", () =>
    expectFail(`<App {...a} key="x" {...{ key: "spread" }} />;`));

  it("does not flag a key after two leading spreads", () =>
    expectPass(`[<App {...a} {...b} key="x" />];`));

  // A spread that provably carries no `key` creates no extraction
  // ambiguity, so the order does not matter.
  it("does not flag a key after an empty-object spread", () =>
    expectPass(`<App {...{}} key="x" />;`));

  it("does not flag a key after a keyless-object-literal spread", () =>
    expectPass(`<App {...{ className: c }} key="x" />;`));

  it("flags a key before an object-literal spread that carries a key", () =>
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

  it("flags a keyless element returned by a named function callback", () => {
    expectFail(`
      function renderRow(item) {
        return <Item name={item.name} />;
      }
      items.map(renderRow);
    `);
  });

  it("flags a keyless element returned by a named arrow callback", () => {
    expectFail(`
      const renderRow = (item) => <Item name={item.name} />;
      items.flatMap(renderRow);
    `);
  });

  it("flags a keyless element returned by a named Array.from callback", () => {
    expectFail(`
      const renderRow = (item) => <Item name={item.name} />;
      Array.from(items, renderRow);
    `);
  });

  it("does not flag a keyed element returned by a named callback", () => {
    expectPass(`
      const renderRow = (item) => <Item key={item.id} name={item.name} />;
      items.map(renderRow);
    `);
  });

  it("does not flag a named callback that spreads the iteration item", () => {
    expectPass(`
      const renderRow = (item) => <Item {...item} />;
      items.map(renderRow);
    `);
  });

  it("does not flag a named callback whose mapped output is a non-children prop", () => {
    expectPass(`
      const renderRow = (item) => <Item name={item.name} />;
      <Menu items={items.map(renderRow)} />;
    `);
  });

  it("does not flag a named JSX-returning callback that is not an iterator", () => {
    expectPass(`
      const renderRow = (item) => <Item name={item.name} />;
      consume(renderRow);
    `);
  });

  it("keeps same-named callbacks in different scopes separate", () => {
    expectPass(`
      const renderRow = (item) => <Item name={item.name} />;
      const Panel = () => {
        const renderRow = (item) => <Item key={item.id} name={item.name} />;
        return items.map(renderRow);
      };
      consume(renderRow);
    `);
  });

  it("flags each keyless return branch in a named callback", () => {
    const result = runRule(
      jsxKey,
      `
        const renderRow = (item) => {
          if (item.featured) return <FeaturedItem name={item.name} />;
          return <Item name={item.name} />;
        };
        items.map(renderRow);
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
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

  it("does not flag JSX arrays nested in an object-property conditional", () => {
    expectPass(`
      const chip = {
        Icons: isLast ? [<PageIcon />] : [<Wrapper><PageIcon /></Wrapper>],
      };
      consume(chip);
    `);
  });

  it("still flags a conditional JSX array rendered as children", () => {
    expectFail(`const App = ({ ready }) => <>{ready ? [<PageIcon />] : []}</>;`);
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

  it("does not flag the tim-soft base shape: key placed after the gesture spread", () => {
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

  it("does not guess that a gesture prop getter returns a key", () => {
    expectPass(`
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

  it("does not flag a stable key placed after the gesture spread", () => {
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

  // cloudscape property-filter permutations: the spread resolves to a local
  // `const` object literal that provably carries no `key`, so a key
  // written after it creates no ambiguity.
  it("does not flag a key after a spread of a keyless local const object literal", () => {
    expectPass(`
      const tokenProps = { text: "token", onDismiss: () => {} };
      const App = () => (
        <div>
          {[
            <Token {...tokenProps} key="1" />,
            <Token {...tokenProps} key="2" />,
          ]}
        </div>
      );
    `);
  });

  it("flags a key before a spread of a local const object literal that carries a key", () => {
    expectFail(`
      const withKey = { key: "boom", text: "token" };
      items.map((item) => <Token key={item.id} {...withKey} />);
    `);
  });

  it("does not guess what an opaque Object.assign source contains", () => {
    expectPass(`
      const common = { text: "token" };
      Object.assign(common, extra);
      items.map((item) => <Token key={item.id} {...common} />);
    `);
  });

  it("flags a key before a const given a key by Object.assign", () => {
    expectFail(`
      const common = { text: "token" };
      Object.assign(common, { key: "boom" });
      items.map((item) => <Token key={item.id} {...common} />);
    `);
  });

  it("flags a key before a spread of a const object literal mutated via member assignment", () => {
    expectFail(`
      const common = { text: "token" };
      common.key = "boom";
      items.map((item) => <Token key={item.id} {...common} />);
    `);
  });

  // nexu-io PreviewModal: `{...(item.testId ? { 'data-testid': item.testId } : {})}`
  // — both branches are provably keyless literals.
  it("does not flag a key after a conditional spread whose branches are keyless literals", () => {
    expectPass(`
      items.map((item) => (
        <li {...(item.testId ? { "data-testid": item.testId } : {})} key={item.id} />
      ));
    `);
  });

  it("does not guess that an unprovable conditional branch carries a key", () => {
    expectPass(`
      items.map((item, i) => (
        <li key={i} {...(item.disabled ? {} : getAnalyticsAttributes(item))} />
      ));
    `);
  });

  it("flags a key before a conditional spread with a keyed branch", () => {
    expectFail(`
      items.map((item, i) => (
        <li key={i} {...(item.disabled ? {} : { key: item.id })} />
      ));
    `);
  });

  it("does not flag a key after a logical-and spread whose object side is keyless", () => {
    expectPass(`items.map((item) => <li {...(item.wide && { colSpan: 2 })} key={item.id} />);`);
  });

  // React strips `key` before props reach a class component, so
  // `{...this.props}` can never carry one.
  it("does not flag a key after a this.props spread", () => {
    expectPass(`
      class Dropdown extends Component {
        render() {
          return [<Menu {...this.props} key="dropdown" />];
        }
      }
    `);
  });

  it("does not flag a key after a rest spread whose pattern destructured the key away", () => {
    expectPass(`
      const Row = (rowInput) => {
        const { key, ...rest } = rowInput;
        return items.map((item) => <li {...rest} key={item.id} />);
      };
    `);
  });

  it("does not guess that an opaque rest spread carries a key", () => {
    expectPass(`
      const Row = (rowInput) => {
        const { label, ...rest } = rowInput;
        return items.map((item) => <li key={item.id} {...rest} />);
      };
    `);
  });

  // A component props rest binding cannot carry `key` because React strips it
  // before invoking the component.
  it("does not flag the issue-1078 typed FC shape: key before a props rest spread", () => {
    expectPass(`
      const Checkboxes: FC<CheckboxesProps> = ({className, ...rest}) => (
        <div>
          {options.map((option) => (
            <Checkbox key={option.name} label={option.label} name={option.name} {...rest} />
          ))}
        </div>
      );
    `);
  });

  it("does not flag the issue-1078 Omit-props shape: key before a props rest spread", () => {
    expectPass(`
      const BaseRadioButtons: FC<BaseRadioButtonsProps> = ({
        children, className, classNameLabel, isHorizontal, options, ...props
      }) => (
        <CheckboxRadioGroup className={className} isHorizontal={isHorizontal}>
          {options.map((option) => (
            <InputRadio key={option.value} className={classNameLabel} option={option} {...props} />
          ))}
          {children}
        </CheckboxRadioGroup>
      );
    `);
  });

  // A props rest binding stays safe in either order.
  it("does not flag a key after a props rest-parameter spread (arrow)", () => {
    expectPass(`
      const Checkboxes = ({options, ...rest}) => (
        <div>
          {options.map((option) => (
            <input {...rest} key={option.name} type="checkbox" />
          ))}
        </div>
      );
    `);
  });

  it("does not flag a key after a props rest-parameter spread (function expression)", () => {
    expectPass(`
      const List = function({items, ...props}) {
        return items.map((item) => <li {...props} key={item.id} />);
      };
    `);
  });

  it("does not flag a key after a defaulted props rest-parameter spread", () => {
    expectPass(`
      const Chips = ({labels, ...rest} = {}) =>
        labels.map((label) => <span {...rest} key={label} />);
    `);
  });

  it("does not guess that an unresolved defaultProps spread carries a key", () => {
    expectPass(`
      class Week extends Component {
        render() {
          const days = [];
          days.push(
            <WeekNumber
              key="W"
              {...Week.defaultProps}
              {...this.props}
              weekNumber={weekNumber}
            />,
          );
          return days;
        }
      }
    `);
  });

  it("does not guess that an unresolved identifier spread carries a key", () => {
    expectPass(`items.map((item) => <Row key={item.id} {...rowProps} />);`);
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
