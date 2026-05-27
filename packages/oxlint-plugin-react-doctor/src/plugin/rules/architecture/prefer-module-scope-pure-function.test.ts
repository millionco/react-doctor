import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { preferModuleScopePureFunction } from "./prefer-module-scope-pure-function.js";

describe("prefer-module-scope-pure-function", () => {
  it("flags a pure helper defined inside a component", () => {
    const result = runRule(
      preferModuleScopePureFunction,
      `
      function App() {
        const formatName = (user) => user.firstName + " " + user.lastName;
        return null;
      }
    `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("formatName");
    expect(result.diagnostics[0].message).toContain("App");
  });

  it("flags a function declaration inside a custom hook", () => {
    const result = runRule(
      preferModuleScopePureFunction,
      `
      function useStuff() {
        function add(a, b) {
          return a + b;
        }
        return add;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("add");
  });

  it("flags a helper that only uses module-scope imports", () => {
    const result = runRule(
      preferModuleScopePureFunction,
      `
      import { capitalize } from "./utils";

      function App() {
        const formatName = (user) => capitalize(user.name);
        return null;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a helper that closes over component state", () => {
    const result = runRule(
      preferModuleScopePureFunction,
      `
      import { useState } from "react";

      function App() {
        const [count, setCount] = useState(0);
        const increment = () => setCount(count + 1);
        return null;
      }
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a helper that uses props", () => {
    const result = runRule(
      preferModuleScopePureFunction,
      `
      function App({ items }) {
        const getCount = () => items.length;
        return null;
      }
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag callbacks wrapped in useCallback", () => {
    const result = runRule(
      preferModuleScopePureFunction,
      `
      import { useCallback } from "react";

      function App() {
        const onClick = useCallback((event) => {
          event.preventDefault();
        }, []);
        return null;
      }
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag PascalCase nested components (covered by no-nested-component-definition)", () => {
    const result = runRule(
      preferModuleScopePureFunction,
      `
      function App() {
        const Greeting = () => null;
        return null;
      }
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag plain top-level functions", () => {
    const result = runRule(
      preferModuleScopePureFunction,
      `
      const formatName = (user) => user.firstName;

      function App() {
        return null;
      }
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag helpers inside non-component functions", () => {
    const result = runRule(
      preferModuleScopePureFunction,
      `
      function makeApi() {
        const format = (x) => x.trim();
        return format;
      }
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("flags helpers that only call globals (console, setTimeout, Math)", () => {
    const result = runRule(
      preferModuleScopePureFunction,
      `
      function App() {
        const logIt = (message) => {
          console.log(message);
          setTimeout(() => console.warn(message), Math.random() * 1000);
        };
        return null;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("logIt");
  });

  it("flags helpers that read another module-scope helper", () => {
    const result = runRule(
      preferModuleScopePureFunction,
      `
      const stripPrefix = (s) => s.replace(/^prefix-/, "");

      function App() {
        const formatLabel = (label) => stripPrefix(label).toUpperCase();
        return null;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("formatLabel");
  });

  it("flags a generator function declaration with no local captures", () => {
    const result = runRule(
      preferModuleScopePureFunction,
      `
      function App() {
        function* range(start, end) {
          for (let i = start; i < end; i++) yield i;
        }
        return null;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("range");
  });

  it("flags an async arrow with no local captures", () => {
    const result = runRule(
      preferModuleScopePureFunction,
      `
      function App() {
        const fetchUser = async (id) => {
          const response = await fetch(\`/api/users/\${id}\`);
          return response.json();
        };
        return null;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("fetchUser");
  });

  it("flags a generator function expression assigned to a const", () => {
    const result = runRule(
      preferModuleScopePureFunction,
      `
      function App() {
        const ids = function* () {
          let counter = 0;
          while (true) yield counter++;
        };
        return null;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("ids");
  });

  it("flags an async function declaration with no local captures", () => {
    const result = runRule(
      preferModuleScopePureFunction,
      `
      function App() {
        async function loadUser(id) {
          const response = await fetch(\`/api/users/\${id}\`);
          return response.json();
        }
        return null;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("loadUser");
  });

  it("does not flag an async function that closes over component state", () => {
    const result = runRule(
      preferModuleScopePureFunction,
      `
      import { useState } from "react";

      function App() {
        const [token, setToken] = useState("");
        const loadUser = async (id) => {
          const response = await fetch(\`/api/users/\${id}\`, {
            headers: { authorization: token },
          });
          return response.json();
        };
        return null;
      }
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag helpers that read another local helper which closes over state", () => {
    const result = runRule(
      preferModuleScopePureFunction,
      `
      import { useState } from "react";

      function App() {
        const [count, setCount] = useState(0);
        const getCount = () => count;
        const doubleCount = () => getCount() * 2;
        return null;
      }
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });
});
