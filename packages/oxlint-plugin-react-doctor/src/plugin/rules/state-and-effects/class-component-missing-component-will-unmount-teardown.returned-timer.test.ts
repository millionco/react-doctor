import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { classComponentMissingComponentWillUnmountTeardown } from "./class-component-missing-component-will-unmount-teardown.js";

const source = `
  import { Component } from "react";
  type InheritedClock = typeof Component;

  class Clock extends Component {
    private timer: number | undefined;

    componentDidMount() {
      this.timer = this.start(this.props.delay);
    }

    componentDidUpdate(previous) {
      if (previous.delay !== this.props.delay) {
        clearInterval(this.timer);
        this.timer = this.start(this.props.delay);
      }
    }

    start(delay) {
      return setInterval(() => this.setState({ tick: Date.now() }), delay);
    }

    componentWillUnmount() {
      clearInterval(this.timer);
    }
  }

  export default Clock;
`;

describe("class teardown for a returned interval handle", () => {
  it("accepts a stored interval replaced only after clearing and released at unmount", () => {
    const result = runRule(classComponentMissingComponentWillUnmountTeardown, source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    [
      "discarded update result",
      source.replace("        this.timer = this.start", "        this.start"),
    ],
    [
      "different unmount handle",
      source.replace(
        "      clearInterval(this.timer);\n    }",
        "      clearInterval(this.other);\n    }",
      ),
    ],
    ["uncleared replacement", source.replace("        clearInterval(this.timer);", "")],
    [
      "escaped helper",
      source.replace("    start(delay) {", "    leak() { return this.start; }\n    start(delay) {"),
    ],
    [
      "another field writer",
      source.replace("    start(delay) {", "    replace() { this.timer = 1; }\n    start(delay) {"),
    ],
    [
      "dynamic instance member",
      source.replace(
        "    start(delay) {",
        "    expose(name) { return this[name]; }\n    start(delay) {",
      ),
    ],
    [
      "prototype mutation",
      source.replace(
        "  export default Clock;",
        "  Object.defineProperty(Clock.prototype, 'start', { value: other });\n  export default Clock;",
      ),
    ],
    [
      "mutable global timer namespace",
      source.replace(
        "  export default Clock;",
        "  window.clearInterval = other;\n  export default Clock;",
      ),
    ],
    [
      "overwritten React instance method",
      source.replace(
        "    start(delay) {",
        "    change() { this.setState = other; }\n    start(delay) {",
      ),
    ],
    [
      "shadowed release",
      source.replace("  class Clock", "  const clearInterval = other;\n  class Clock"),
    ],
    [
      "alternate DOM timer provider mutation",
      source.replace(
        "  export default Clock;",
        "  document.defaultView.clearInterval = other;\n  export default Clock;",
      ),
    ],
    [
      "reflected timer-provider replacement",
      source.replace(
        "  export default Clock;",
        '  const host = document.defaultView; Reflect.set(host, "setInterval", other);\n  export default Clock;',
      ),
    ],
    [
      "same-file subclass override",
      source.replace(
        "  export default Clock;",
        "  class CustomClock extends Clock { start() { return other(); } }\n  export default Clock;",
      ),
    ],
    ["public handle field", source.replace("private timer", "public timer")],
    [
      "computed override",
      source.replace(
        "    start(delay) {",
        "    [replacement]() { return other(); }\n    start(delay) {",
      ),
    ],
    ["unproven React base", source.replace('from "react"', 'from "foreign-react-like"')],
    [
      "named React prototype mutation",
      source.replace(
        "  class Clock",
        "  Component.prototype.setState = function () { this.timer = undefined; };\n  class Clock",
      ),
    ],
    [
      "namespace React prototype mutation",
      source
        .replace("import { Component }", "import * as React")
        .replace("extends Component", "extends React.Component")
        .replace("typeof Component", "typeof React.Component")
        .replace(
          "  class Clock",
          "  React.Component.prototype.setState = function () { this.timer = undefined; };\n  class Clock",
        ),
    ],
    [
      "alternate React import",
      source.replace(
        "  class Clock",
        '  import { Component as OtherBase } from "react"; OtherBase.prototype.setState = other;\n  class Clock',
      ),
    ],
    [
      "native module-loader capability",
      source.replace(
        "  class Clock",
        `  import { createRequire } from "node:module";
           const loadReact = createRequire(import.meta.url);
           const facade = loadReact("react");
           facade.Component.prototype.setState = function () { this.timer = undefined; };
           class Clock`,
      ),
    ],
    [
      "external TypeScript import-equals",
      source.replace(
        "  class Clock",
        `  import facade = require("react");
           facade.Component.prototype.setState = function () { this.timer = undefined; };
           class Clock`,
      ),
    ],
    [
      "runtime TypeScript qualified import-equals",
      source
        .replace("import { Component }", "import * as React")
        .replace("extends Component", "extends React.Component")
        .replace("typeof Component", "typeof React.Component")
        .replace(
          "  class Clock",
          `  import Base = React.Component;
             Base.prototype.setState = function () { this.timer = undefined; };
             class Clock`,
        ),
    ],
    [
      "escaped relative import",
      source.replace(
        "  class Clock",
        "  import { format } from './format'; const alias = format;\n  class Clock",
      ),
    ],
    [
      "relative initializer result used as a loader",
      source.replace(
        "  class Clock",
        `  import { setup } from './format';
           const loadReact = setup();
           const facade = loadReact("react");
           facade.Component.prototype.setState = function () { this.timer = undefined; };
           class Clock`,
      ),
    ],
    [
      "inherited receiver assignment",
      source.replace(
        "() => this.setState({ tick: Date.now() })",
        "() => { super.timer = undefined; this.setState({ tick: Date.now() }); }",
      ),
    ],
    [
      "local render consumer can mutate a relative provider",
      source
        .replace(
          "  class Clock",
          `  import { readFacade } from './relative';
             function writeFacade({ facade }) {
               facade.Component.prototype.setState = function () { this.timer = undefined; };
             }
             class Clock`,
        )
        .replace(
          "    componentDidMount()",
          "    render() { const facade = readFacade(); return writeFacade({ facade }); }\n    componentDidMount()",
        ),
    ],
    [
      "Node timer-provider replacement",
      source.replace(
        "  class Clock",
        `  process.getBuiltinModule("node:vm").runInThisContext("globalThis.clearInterval = () => {}");
           class Clock`,
      ),
    ],
    ["different timer API", source.replaceAll("clearInterval", "clearTimeout")],
  ])("retains the warning for %s", (_name, code) => {
    const result = runRule(classComponentMissingComponentWillUnmountTeardown, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows relative named helpers only in direct render and module initializer calls", () => {
    const code = source
      .replace(
        "  class Clock",
        "  import { format, setup } from './format'; const settings = setup();\n  class Clock",
      )
      .replace(
        "    componentDidMount()",
        `    static defaultProps = { renderer: settings };
            render() { const text = format(this.props.delay); return this.props.renderer({ text }); }
            componentDidMount()`,
      );
    const result = runRule(classComponentMissingComponentWillUnmountTeardown, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("preserves direct same-method timer cleanup", () => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      `
        import { Component } from "react";

        class Clock extends Component {
          componentDidMount() { this.timer = setInterval(tick, 100); }
          componentWillUnmount() { clearInterval(this.timer); }
        }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
});
