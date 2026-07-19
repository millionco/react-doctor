import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { valtioNoProxyReadInRender } from "./valtio-no-proxy-read-in-render.js";

const runValtioRule = (code: string) => runRule(valtioNoProxyReadInRender, code);

describe("valtio-no-proxy-read-in-render", () => {
  it("reports a direct proxy property read after useSnapshot", () => {
    const result = runValtioRule(`
      import { useSnapshot } from "valtio";
      import { state } from "./state";

      export const Counter = () => {
        const snapshot = useSnapshot(state);
        return <span>{state.count}</span>;
      };
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("snapshot");
  });

  it("reports proxy reads through hook and proxy aliases", () => {
    const result = runValtioRule(`
      import { useSnapshot as useValtioSnapshot } from "valtio/react";
      import { state } from "./state";
      const proxyAlias = state;
      const snapshotHook = useValtioSnapshot;

      function Profile() {
        const snapshot = snapshotHook(proxyAlias);
        return proxyAlias.profile.name;
      }
    `);

    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports reads through proxy aliases not used by useSnapshot", () => {
    const result = runValtioRule(`
      import { useSnapshot } from "valtio";

      function Profile({ state }) {
        const stateAlias = state;
        const profileAlias = state.profile;
        const snapshot = useSnapshot(state.profile);
        return stateAlias.profile.name + profileAlias.name + snapshot.name;
      }
    `);

    expect(result.diagnostics).toHaveLength(2);
  });

  it("reports reads through nested aliases after snapping their parent", () => {
    const result = runValtioRule(`
      import { useSnapshot } from "valtio";

      function Profile({ state }) {
        const profileAlias = state.profile;
        const { settings } = state;
        const snapshot = useSnapshot(state);
        return profileAlias.name + settings.theme + snapshot.profile.name;
      }
    `);

    expect(result.diagnostics).toHaveLength(2);
  });

  it("reports namespace imports and namespace aliases", () => {
    const result = runValtioRule(`
      import * as Valtio from "valtio";
      import { state } from "./state";
      const ValtioAlias = Valtio;

      function Profile() {
        const snapshot = ValtioAlias.useSnapshot(state);
        return state.profile.name;
      }
    `);

    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports a nested proxy read when that nested proxy was snapped", () => {
    const result = runValtioRule(`
      import { useSnapshot } from "valtio";

      function Profile({ state }) {
        const snapshot = useSnapshot(state.profile);
        return <span>{state.profile.name}</span>;
      }
    `);

    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports reads through a destructured proxy alias", () => {
    const result = runValtioRule(`
      import { useSnapshot } from "valtio";

      function Profile({ state }) {
        const { profile } = state;
        const snapshot = useSnapshot(profile);
        return profile.name;
      }
    `);

    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports reads after snapping a defaulted destructured proxy alias", () => {
    const result = runValtioRule(`
      import { useSnapshot } from "valtio";

      function Profile({ state, fallbackProfile }) {
        const { profile = fallbackProfile } = state;
        const snapshot = useSnapshot(profile);
        return <span>{state.profile.name + snapshot.name}</span>;
      }
    `);

    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports whole-proxy and render-time destructuring reads", () => {
    const result = runValtioRule(`
      import { useSnapshot } from "valtio";

      function Profile({ state }) {
        const snapshot = useSnapshot(state);
        const { name } = state;
        return <Output value={state} name={name} />;
      }
    `);

    expect(result.diagnostics).toHaveLength(2);
  });

  it("reports reads inside synchronous render callbacks", () => {
    const result = runValtioRule(`
      import { useMemo } from "react";
      import { useSnapshot } from "valtio";

      function List({ state, rows }) {
        const snapshot = useSnapshot(state);
        const labels = rows.map(() => state.label);
        const memoizedLabel = useMemo(() => state.label, []);
        const immediateLabel = (() => state.label)();
        return <>{labels}{memoizedLabel}{immediateLabel}</>;
      }
    `);

    expect(result.diagnostics).toHaveLength(3);
  });

  it("keeps proxy reads in deferred callbacks valid", () => {
    const result = runValtioRule(`
      import { useCallback, useEffect } from "react";
      import { useSnapshot } from "valtio";

      function Counter({ state }) {
        const snapshot = useSnapshot(state);
        const handleClick = () => state.count;
        const memoizedClick = useCallback(() => state.count, [state]);
        useEffect(() => {
          const timeoutId = setTimeout(() => console.log(state.count), 10);
          return () => clearTimeout(timeoutId);
        }, [state]);
        return <button onClick={() => state.count++}>{snapshot.count}</button>;
      }
    `);

    expect(result.diagnostics).toEqual([]);
  });

  it("keeps direct assignments, updates, and deletes for mutation-specific rules", () => {
    const result = runValtioRule(`
      import { useSnapshot } from "valtio";

      function Counter({ state }) {
        const snapshot = useSnapshot(state);
        state.count = 1;
        state.count++;
        delete state.temporary;
        return snapshot.count;
      }
    `);

    expect(result.diagnostics).toEqual([]);
  });

  it("keeps proxy writes nested in assignment patterns for mutation-specific rules", () => {
    const result = runValtioRule(`
      import { useSnapshot } from "valtio";

      function Counter({ state, source, values }) {
        const snapshot = useSnapshot(state);
        ({ count: state.count } = source);
        [state.label] = values;
        for ({ count: state.count } of values) {}
        return snapshot.count;
      }
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("reports proxy reads used as computed assignment keys", () => {
    const result = runValtioRule(`
      import { useSnapshot } from "valtio";

      function Counter({ state, target, source }) {
        const snapshot = useSnapshot(state);
        target[state.key] = source;
        ({ [state.label]: target.value } = source);
        target[typeof state.type] = source;
        return snapshot.key;
      }
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(3);
  });

  it("reports snapshot reads and stays quiet on the corresponding proxy", () => {
    const result = runValtioRule(`
      import { useSnapshot } from "valtio";

      function Counter({ state }) {
        const snapshot = useSnapshot(state);
        return <span>{snapshot.count}</span>;
      }
    `);

    expect(result.diagnostics).toEqual([]);
  });

  it("stays quiet when the proxy is read before a snapshot binding is available", () => {
    const result = runValtioRule(`
      import { useSnapshot } from "valtio";

      function Counter({ state }) {
        const count = state.count;
        const snapshot = useSnapshot(state);
        return <span>{count + snapshot.count}</span>;
      }
    `);

    expect(result.diagnostics).toEqual([]);
  });

  it("reports a proxy read in a later declarator of the snapshot declaration", () => {
    const result = runValtioRule(`
      import { useSnapshot } from "valtio";

      function Counter({ state }) {
        const snapshot = useSnapshot(state), count = state.count;
        return <span>{count + snapshot.count}</span>;
      }
    `);

    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet when useSnapshot's result is discarded", () => {
    const result = runValtioRule(`
      import { useSnapshot } from "valtio";

      function Counter({ state }) {
        useSnapshot(state);
        return <span>{state.count}</span>;
      }
    `);

    expect(result.diagnostics).toEqual([]);
  });

  it("stays quiet outside the lexical scope of the snapshot binding", () => {
    const result = runValtioRule(`
      import { useSnapshot } from "valtio";

      function Counter({ state, enabled }) {
        if (enabled) {
          const snapshot = useSnapshot(state);
          console.log(snapshot.count);
        }
        return <span>{state.count}</span>;
      }
    `);

    expect(result.diagnostics).toEqual([]);
  });

  it("stays quiet for a shadowed useSnapshot binding", () => {
    const result = runValtioRule(`
      import { useSnapshot } from "valtio";

      function Counter({ state, useSnapshot }) {
        const snapshot = useSnapshot(state);
        return <span>{state.count}</span>;
      }
    `);

    expect(result.diagnostics).toEqual([]);
  });

  it("stays quiet for similarly named hooks from other modules", () => {
    const result = runValtioRule(`
      import { useSnapshot } from "not-valtio";

      function Counter({ state }) {
        const snapshot = useSnapshot(state);
        return <span>{state.count}</span>;
      }
    `);

    expect(result.diagnostics).toEqual([]);
  });

  it("stays quiet when the snapshot and read use different proxies", () => {
    const result = runValtioRule(`
      import { useSnapshot } from "valtio";

      function Counter({ firstState, secondState }) {
        const snapshot = useSnapshot(firstState);
        return <span>{secondState.count}</span>;
      }
    `);

    expect(result.diagnostics).toEqual([]);
  });

  it("stays quiet when a nested proxy is replaced between the snapshot and read", () => {
    const result = runValtioRule(`
      import { useSnapshot } from "valtio";

      function Profile({ state, nextProfile }) {
        const snapshot = useSnapshot(state.profile);
        state.profile = nextProfile;
        return <span>{state.profile.name}</span>;
      }
    `);

    expect(result.diagnostics).toEqual([]);
  });

  it("reports through an alias that captured the snapped proxy before replacement", () => {
    const result = runValtioRule(`
      import { useSnapshot } from "valtio";

      function Profile({ state, nextProfile }) {
        const profile = state.profile;
        const snapshot = useSnapshot(profile);
        state.profile = nextProfile;
        return <span>{profile.name + snapshot.name}</span>;
      }
    `);

    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat an alias of the proxy root as capturing a replaced nested proxy", () => {
    const result = runValtioRule(`
      import { useSnapshot } from "valtio";

      function Profile({ state, nextProfile }) {
        const stateAlias = state;
        const snapshot = useSnapshot(stateAlias.profile);
        stateAlias.profile = nextProfile;
        return <span>{stateAlias.profile.name}</span>;
      }
    `);

    expect(result.diagnostics).toEqual([]);
  });

  it("recognizes nested proxy replacement through alternate aliases", () => {
    const result = runValtioRule(`
      import { useSnapshot } from "valtio";

      function DirectReplacement({ state, nextProfile }) {
        const stateAlias = state;
        const snapshot = useSnapshot(state.profile);
        stateAlias.profile = nextProfile;
        return <span>{state.profile.name + snapshot.name}</span>;
      }

      function DestructuredReplacement({ state, source }) {
        const stateAlias = state;
        const snapshot = useSnapshot(state.profile);
        ({ profile: stateAlias.profile } = source);
        return <span>{state.profile.name + snapshot.name}</span>;
      }
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("supports transparent TypeScript wrappers", () => {
    const result = runValtioRule(`
      import { useSnapshot } from "valtio";

      function Counter({ state }: Props) {
        const snapshot = useSnapshot((state as Store)!);
        return <span>{(state as Store)!.count}</span>;
      }
    `);

    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays conservative for dynamic nested proxy targets", () => {
    const result = runValtioRule(`
      import { useSnapshot } from "valtio";

      function Item({ state, keyName }) {
        const snapshot = useSnapshot(state[keyName]);
        return <span>{state[keyName].name}</span>;
      }
    `);

    expect(result.diagnostics).toEqual([]);
  });
});
