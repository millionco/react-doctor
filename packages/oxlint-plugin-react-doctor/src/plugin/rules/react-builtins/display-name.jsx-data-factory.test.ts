import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { displayName } from "./display-name.js";

describe("display-name JSX data factories", () => {
  it.each([
    `export const makeSections = (options) => ({ query }) => {
      const sections = [{ items: [{ title: options.title, icon: <Icon /> }] }];
      const filtered = sections.map(section => ({
        ...section,
        items: section.items.filter(item => item.title.includes(query)),
      }));
      return filtered.filter(section => section.items.length !== 0);
    };`,
    `export const makeSections = () => () => ({ icon: <Icon /> });`,
    `export const makeSections = () => () => [{ icon: <Icon /> }];`,
    `export const makeSections = () => () => {
      const sections = [{ icon: <Icon /> }];
      return sections;
    };`,
    `export const makeSections = () => () => {
      const renderIcon = () => <Icon />;
      return { renderIcon };
    };`,
    `export const makeSections = () => function () { return { icon: <Icon /> }; };`,
    `export const makeSections = () => function () {
      const sections = [{ icon: <Icon /> }];
      return sections;
    };`,
    `export default () => ({ icon: <Icon /> });`,
    `module.exports = function () { return { icon: <Icon /> }; };`,
    `export const makeSections = () => () => serialize(<Icon />);`,
    `export const makeSections = () => () => (<Icon /> ? { title: "yes" } : {});`,
    `export const makeSections = () => () => (<Icon />, { title: "yes" });`,
    `export const makeSections = () => () => ({ icon: <Icon /> } satisfies Descriptor);`,
    `export const makeSections = () => () => [{ icon: createElement(Icon) }];`,
    `export const makeSections = () => () => {
      const element = <span>Icon</span>;
      const descriptor = { icon: element };
      const alias = descriptor;
      return [alias];
    };`,
    `export const makeSections = () => () => {
      const element = <span>Icon</span>;
      return [{ icon: element }];
    };`,
    `export const makeSections = () => () => {
      const render = () => <span>Icon</span>;
      const alias = render;
      return [alias];
    };`,
    `export const makeSections = () => () => {
      const element = <span>Icon</span>;
      {
        const element = { title: "Section" };
        return [element];
      }
    };`,
    `export const makeSections = () => () => {
      let element = <span>Icon</span>;
      element = { title: "Section" };
      return [element];
    };`,
    `export const makeSections = () => () => {
      const unused = <span>Icon</span>;
      const output = [output];
      return output;
    };`,
    `import { element } from "./data";
    export const makeSections = () => () => {
      const unused = <span>Icon</span>;
      return [element];
    };`,
  ])("ignores a data result containing JSX: %s", (code) => {
    const result = runRule(displayName, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    `export const makeComponent = () => () => <Icon />;`,
    `export const makeComponent = () => { return () => <Icon />; };`,
    `export const makeComponent = () => { return function () { return <Icon />; }; };`,
    `export const makeComponent = () => () => <><Icon /></>;`,
    `export const makeComponent = () => () => [<Icon key="icon" />];`,
    `export const makeComponent = () => () => [[<Icon key="icon" />]];`,
    `export const makeComponent = () => () => {
      const output = [<Icon key="icon" />];
      return output;
    };`,
    `export const makeComponent = () => () => ready ? <Icon /> : null;`,
    `export const makeComponent = () => () => ready && <Icon />;`,
    `export const makeComponent = () => () => [ready ? <Icon /> : null];`,
    `export const makeComponent = () => () => (prepare(), <Icon />);`,
    `export const makeComponent = () => () => (<Icon /> satisfies ReactNode);`,
    `export const makeComponent = () => () => {
      const output = <Icon />;
      return output;
    };`,
    `export const makeComponent = () => () => {
      const render = () => <Icon />;
      return render();
    };`,
    `export const makeComponent = () => () => React.createElement(Icon);`,
    `export const makeComponent = () => () => createElement(Icon);`,
    `export default () => <Icon />;`,
    `module.exports = function () { return <Icon />; };`,
    `module.exports = React.memo(() => <Icon />);`,
    `module.exports = React.forwardRef((props, ref) => <Icon ref={ref} />);`,
    `module.exports = observer(() => <Icon />);`,
    `export const createView = () => () => {
      const element = <span>Rendered</span>;
      return [element];
    };`,
    `export const createView = () => () => {
      const element = <span>Rendered</span>;
      const alias = element;
      const output = [alias];
      return [output];
    };`,
    `export const createView = () => () => {
      const element = <><span>Rendered</span></>;
      return [element satisfies ReactNode];
    };`,
    `export const createView = () => () => {
      const element = <span>Rendered</span>;
      return [ready ? element : null];
    };`,
    `export const createView = () => () => {
      const element = <span>Rendered</span>;
      return [ready && element];
    };`,
    `export const createView = () => () => {
      const element = <span>Rendered</span>;
      return [(prepare(), element)];
    };`,
  ])("preserves anonymous render-output diagnostics: %s", (code) => {
    const result = runRule(displayName, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
