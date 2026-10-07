import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noImpureStateUpdater } from "./no-impure-state-updater.js";

describe("updater parameter reassignment", () => {
  it.each(["++previous", "--previous", "previous++", "previous += 1", "previous = 2"])(
    "accepts local parameter operation %s",
    (operation) => {
      const result = runRule(
        noImpureStateUpdater,
        `
        import { useState } from 'react';
        const Counter = () => {
          const [count, setCount] = useState(0);
          return <button onClick={() => setCount(previous => ${operation})}>{count}</button>;
        };
      `,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(0);
    },
  );

  it.each(["++previous.count", "previous.count = 2", "++captured", "captured = 2"])(
    "still reports external mutation %s",
    (operation) => {
      const result = runRule(
        noImpureStateUpdater,
        `
        import { useState } from 'react';
        let captured = 0;
        const Counter = () => {
          const [value, setValue] = useState({ count: 0 });
          return <button onClick={() => setValue(previous => { ${operation}; return previous; })}>Change</button>;
        };
      `,
      );
      expect(result.diagnostics).toHaveLength(1);
    },
  );
});
