import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noCleanupOnlyEffectWithReactiveDeps } from "./no-cleanup-only-effect-with-reactive-deps.js";

describe("no-cleanup-only-effect-with-reactive-deps", () => {
  it("flags the whole props object in a cleanup-only effect", () => {
    const result = runRule(
      noCleanupOnlyEffectWithReactiveDeps,
      `
      function EmailModal(props) {
        const [status, setStatus] = useState("idle");
        useEffect(() => {
          return () => {
            if (status === "success") props.onEmailThreadFetched();
          };
        }, [status, props]);
        return null;
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("props");
  });

  it("flags reactive prop deps in a cleanup-only effect", () => {
    const result = runRule(
      noCleanupOnlyEffectWithReactiveDeps,
      `
      function Toast({ id, onClose }) {
        useEffect(() => {
          return () => onClose(id);
        }, [id, onClose]);
        return null;
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("flags a render-local fresh object dep", () => {
    const result = runRule(
      noCleanupOnlyEffectWithReactiveDeps,
      `
      function Player(props) {
        const config = { src: props.src };
        useEffect(() => {
          return () => teardownPlayer(config);
        }, [config]);
        return null;
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a cleanup-only useLayoutEffect with whole props", () => {
    const result = runRule(
      noCleanupOnlyEffectWithReactiveDeps,
      `
      function Tooltip(props) {
        useLayoutEffect(() => {
          return () => props.onHidden();
        }, [props]);
        return null;
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a concise-body cleanup-only effect with whole props", () => {
    const result = runRule(
      noCleanupOnlyEffectWithReactiveDeps,
      `
      function Logger(props) {
        useEffect(() => () => props.flush(), [props]);
        return null;
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a prop-member dep on the whole props object", () => {
    const result = runRule(
      noCleanupOnlyEffectWithReactiveDeps,
      `
      function Widget(props) {
        useEffect(() => {
          return () => cleanup(props.id);
        }, [props.id]);
        return null;
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a cleanup-only effect with empty deps", () => {
    const result = runRule(
      noCleanupOnlyEffectWithReactiveDeps,
      `
      function Sub(props) {
        useEffect(() => {
          return () => props.onUnmount();
        }, []);
        return null;
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an effect that has real setup work", () => {
    const result = runRule(
      noCleanupOnlyEffectWithReactiveDeps,
      `
      function Timer({ ms, onTick }) {
        useEffect(() => {
          const id = setInterval(onTick, ms);
          return () => clearInterval(id);
        }, [ms, onTick]);
        return null;
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a cleanup-only effect with only a primitive state dep", () => {
    const result = runRule(
      noCleanupOnlyEffectWithReactiveDeps,
      `
      function Track() {
        const [page, setPage] = useState(0);
        useEffect(() => {
          return () => analytics.flush();
        }, [page]);
        return null;
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a cleanup-only effect with no dep array", () => {
    const result = runRule(
      noCleanupOnlyEffectWithReactiveDeps,
      `
      function Logger(props) {
        useEffect(() => {
          return () => props.flush();
        });
        return null;
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a cleanup-only effect with a single stable event dep", () => {
    const result = runRule(
      noCleanupOnlyEffectWithReactiveDeps,
      `
      function EmailModal(props) {
        const mark = useEffectEvent(() => props.onEmailThreadFetched());
        useEffect(() => {
          return () => mark();
        }, [mark]);
        return null;
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
