import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noJsonParseStringifyClone } from "./no-json-parse-stringify-clone.js";

describe("no-json-parse-stringify-clone", () => {
  it("flags `JSON.parse(JSON.stringify(obj))`", () => {
    const result = runRule(
      noJsonParseStringifyClone,
      `const copy = JSON.parse(JSON.stringify(state));`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("structuredClone");
  });

  it("flags the clone even when a replacer/reviver reference is passed", () => {
    const result = runRule(
      noJsonParseStringifyClone,
      `const copy = JSON.parse(JSON.stringify(state, replacer), reviver);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  // RDE (AFFiNE `cleanObject`): an inline function replacer transforms/filters
  // the output, so `structuredClone` is not an equivalent rewrite — don't flag.
  it("does not flag when a function replacer transforms the output", () => {
    const result = runRule(
      noJsonParseStringifyClone,
      `const clean = JSON.parse(JSON.stringify(obj, (k, v) => (keep(k) ? v : undefined)));`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when an array (allowlist) replacer is passed", () => {
    const result = runRule(
      noJsonParseStringifyClone,
      `const picked = JSON.parse(JSON.stringify(obj, ["id", "name"]));`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag `JSON.stringify(JSON.parse(str))` (normalization, not a clone)", () => {
    const result = runRule(noJsonParseStringifyClone, `const s = JSON.stringify(JSON.parse(raw));`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a plain `JSON.parse(str)`", () => {
    const result = runRule(noJsonParseStringifyClone, `const data = JSON.parse(raw);`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag `JSON.parse` of a non-stringify call", () => {
    const result = runRule(noJsonParseStringifyClone, `const data = JSON.parse(readFile());`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a non-JSON object with parse/stringify methods", () => {
    const result = runRule(noJsonParseStringifyClone, `const x = YAML.parse(YAML.stringify(obj));`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag passing `JSON.stringify` as a reference (not called)", () => {
    const result = runRule(noJsonParseStringifyClone, `const fn = JSON.parse(JSON.stringify);`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a clone directly inside a snapshot* helper (persistence exemption)", () => {
    const result = runRule(
      noJsonParseStringifyClone,
      `function snapshotState(state) { return JSON.parse(JSON.stringify(state)); }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  // The nearest NAMED enclosing function decides the exemption: a helper
  // bound to a `clone`-named binding is exactly the deep clone the rule
  // redirects, even when a snapshot* function encloses it.
  it("flags a clone-named nested helper even inside a snapshot* function", () => {
    const result = runRule(
      noJsonParseStringifyClone,
      `function takeSnapshot(state) { const clone = () => JSON.parse(JSON.stringify(state)); return clone(); }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a clone in an ANONYMOUS callback inside a snapshot* helper", () => {
    const result = runRule(
      noJsonParseStringifyClone,
      `function snapshotEntries(items) { return items.map((item) => JSON.parse(JSON.stringify(item))); }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a clone inside a nested helper within a NON-snapshot function", () => {
    const result = runRule(
      noJsonParseStringifyClone,
      `function build(state) { const clone = () => JSON.parse(JSON.stringify(state)); return clone(); }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  // A `Snapshot*`-named React COMPONENT is not a persistence helper: a plain
  // deep clone in one of its handlers is a true positive.
  it("flags a plain deep clone inside a Snapshot*-named component handler", () => {
    const result = runRule(
      noJsonParseStringifyClone,
      `
      function SnapshotList({ items, onDuplicate }) {
        const handleDuplicate = (item) => {
          const copy = JSON.parse(JSON.stringify(item));
          onDuplicate(copy);
        };
        return items.map((item) => (
          <button key={item.id} onClick={() => handleDuplicate(item)}>dup</button>
        ));
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag when an inline function reviver transforms the parsed values", () => {
    const result = runRule(
      noJsonParseStringifyClone,
      `
      const revived = JSON.parse(
        JSON.stringify(payload),
        (key, value) => (typeof value === "string" && ISO_DATE.test(value) ? new Date(value) : value),
      );
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags when the replacer slot is a null literal (pretty-print clone)", () => {
    const result = runRule(
      noJsonParseStringifyClone,
      `const copy = JSON.parse(JSON.stringify(state, null, 2));`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a clone when the `JSON` receiver is wrapped in `as any`", () => {
    const result = runRule(
      noJsonParseStringifyClone,
      `const copy = (JSON as any).parse(JSON.stringify(state));`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag JSON normalization in a getServerSideProps props object", () => {
    const result = runRule(
      noJsonParseStringifyClone,
      `
      export const getServerSideProps = withSessionSsr(async ({ req }) => {
        const apiKeys = await prisma.apiKey.findMany();
        const lists = await prisma.list.findMany();
        return {
          props: {
            user: req.session.user,
            apiKeys: JSON.parse(JSON.stringify(apiKeys)),
            lists: JSON.parse(JSON.stringify(lists)),
          },
        };
      });
      `,
      { filename: "/repo/src/pages/settings.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an aliased JSON normalization returned from getServerSideProps", () => {
    const result = runRule(
      noJsonParseStringifyClone,
      `
      export const getServerSideProps = withSessionSsr(async ({ req }) => {
        const normalizedUser = (() => {
          try {
            return JSON.parse(JSON.stringify(req.session.user));
          } catch {
            return {};
          }
        })();
        const serializedUser = normalizedUser;
        return { props: { user: serializedUser } };
      });
      `,
      { filename: "/repo/src/pages/settings.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag JSON normalization returned from getStaticProps", () => {
    const result = runRule(
      noJsonParseStringifyClone,
      `
      export async function getStaticProps() {
        const articles = await loadArticles();
        return { ["props"]: { articles: JSON.parse(JSON.stringify(articles)) } };
      }
      `,
      { filename: "/repo/pages/index.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag JSON normalization in a conditional page-data return", () => {
    const result = runRule(
      noJsonParseStringifyClone,
      `
      export const getServerSideProps = async ({ preferProps }) => {
        return preferProps
          ? { props: { state: JSON.parse(JSON.stringify(state)) } }
          : { redirect: { destination: "/", permanent: false } };
      };

      export async function getStaticProps({ missing }) {
        return missing
          ? { notFound: true }
          : { props: { state: JSON.parse(JSON.stringify(state)) } };
      }
      `,
      { filename: "/repo/src/pages/settings.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag JSON normalization in a typed concise page-data return", () => {
    const result = runRule(
      noJsonParseStringifyClone,
      `
      export const getServerSideProps = (
        async () =>
          ({
            props: { state: JSON.parse(JSON.stringify(state)) },
          } as GetServerSidePropsResult)
      ) satisfies GetServerSideProps;

      export const getStaticProps = async () =>
        ({
          props: { state: JSON.parse(JSON.stringify(state)) },
        } satisfies GetStaticPropsResult);
      `,
      { filename: "/repo/src/pages/settings.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a clone in a conditional props object that is not returned", () => {
    const result = runRule(
      noJsonParseStringifyClone,
      `
      export const getServerSideProps = async ({ missing }) => {
        const response = missing
          ? { notFound: true }
          : { props: { state: JSON.parse(JSON.stringify(state)) } };
        consume(response);
        return { props: { state } };
      };
      `,
      { filename: "/repo/src/pages/settings.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag JSON normalization in a returned page-result binding", () => {
    const result = runRule(
      noJsonParseStringifyClone,
      `
      export const getServerSideProps = async ({ missing }) => {
        const response = missing
          ? { notFound: true }
          : { props: { state: JSON.parse(JSON.stringify(state)) } };
        return response;
      };
      `,
      { filename: "/repo/src/pages/settings.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag JSON normalization nested in a returned props binding", () => {
    const validSources = [
      `
      export const getServerSideProps = async () => {
        const props = {
          state: JSON.parse(JSON.stringify(state)),
        };
        return { props };
      };
      `,
      `
      export const getServerSideProps = async () => {
        const pageProps = {
          nested: [{ state: JSON.parse(JSON.stringify(state)) }],
        };
        return { props: pageProps };
      };
      `,
    ];
    for (const source of validSources) {
      const result = runRule(noJsonParseStringifyClone, source, {
        filename: "/repo/src/pages/settings.tsx",
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(0);
    }
  });

  it("still flags a nested helper clone that is mutated before page serialization", () => {
    const result = runRule(
      noJsonParseStringifyClone,
      `
      export const getServerSideProps = async () => {
        const buildState = () => {
          const workingCopy = JSON.parse(JSON.stringify(state));
          mutate(workingCopy);
          return workingCopy;
        };
        return { props: { state: buildState() } };
      };
      `,
      { filename: "/repo/src/pages/settings.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a clone passed through an opaque nested props value", () => {
    const result = runRule(
      noJsonParseStringifyClone,
      `
      export const getServerSideProps = async () => {
        const props = {
          state: consume(JSON.parse(JSON.stringify(state))),
        };
        return { props };
      };
      `,
      { filename: "/repo/src/pages/settings.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a clone passed through an opaque directly returned props value", () => {
    const result = runRule(
      noJsonParseStringifyClone,
      `
      export const getServerSideProps = async () => {
        return {
          props: {
            state: consume(JSON.parse(JSON.stringify(state))),
          },
        };
      };
      `,
      { filename: "/repo/src/pages/settings.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a props binding that also escapes through an opaque sibling value", () => {
    const result = runRule(
      noJsonParseStringifyClone,
      `
      export const getServerSideProps = async () => {
        const serializedState = JSON.parse(JSON.stringify(state));
        return {
          props: {
            serializedState,
            escaped: consume(serializedState),
          },
        };
      };
      `,
      { filename: "/repo/src/pages/settings.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a mutated IIFE clone inside directly returned props", () => {
    const result = runRule(
      noJsonParseStringifyClone,
      `
      export const getServerSideProps = async () => {
        return {
          props: {
            state: (() => {
              const workingCopy = JSON.parse(JSON.stringify(state));
              mutate(workingCopy);
              return workingCopy;
            })(),
          },
        };
      };
      `,
      { filename: "/repo/src/pages/settings.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a nested IIFE clone binding that is mutated before page serialization", () => {
    const result = runRule(
      noJsonParseStringifyClone,
      `
      export const getServerSideProps = async () => {
        const serializedState = (() => {
          const workingCopy = JSON.parse(JSON.stringify(state));
          mutate(workingCopy);
          return workingCopy;
        })();
        return { props: { serializedState } };
      };
      `,
      { filename: "/repo/src/pages/settings.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a clone passed through an opaque initializer before page serialization", () => {
    const result = runRule(
      noJsonParseStringifyClone,
      `
      export const getServerSideProps = async () => {
        const serializedState = consume(JSON.parse(JSON.stringify(state)));
        return { props: { serializedState } };
      };
      `,
      { filename: "/repo/src/pages/settings.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags redundant JSON normalization before an API response", () => {
    const result = runRule(
      noJsonParseStringifyClone,
      `
      export default async function handler(req, res) {
        const apiKey = await prisma.apiKey.create();
        const apiKeys = await prisma.apiKey.findMany();
        res.status(201).json({ apiKey: JSON.parse(JSON.stringify(apiKey)) });
        const serializedApiKeys = JSON.parse(JSON.stringify(apiKeys));
        res.status(200).json({ apiKeys: serializedApiKeys });
      }
      `,
      { filename: "/repo/src/pages/api/apiKeys/index.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("still flags a clone not returned in Next.js page props", () => {
    const result = runRule(
      noJsonParseStringifyClone,
      `
      export const getServerSideProps = async () => {
        const workingCopy = JSON.parse(JSON.stringify(state));
        mutate(workingCopy);
        return { props: { state } };
      };
      `,
      { filename: "/repo/src/pages/settings.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a clone in a non-exported getServerSideProps lookalike", () => {
    const result = runRule(
      noJsonParseStringifyClone,
      `
      const getServerSideProps = async () => ({
        props: { state: JSON.parse(JSON.stringify(state)) },
      });
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a separately exported page-data boundary", () => {
    const result = runRule(
      noJsonParseStringifyClone,
      `
      const loadPage = async () => ({
        props: { state: JSON.parse(JSON.stringify(state)) },
      });
      export { loadPage as getServerSideProps };
      `,
      { filename: "/repo/src/pages/settings.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a clone that is mutated before being returned in page props", () => {
    const result = runRule(
      noJsonParseStringifyClone,
      `
      export const getServerSideProps = async () => {
        const workingCopy = JSON.parse(JSON.stringify(state));
        mutate(workingCopy);
        return { props: { workingCopy } };
      };
      `,
      { filename: "/repo/src/pages/settings.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a clone that escapes before being returned in page props", () => {
    const result = runRule(
      noJsonParseStringifyClone,
      `
      export const getServerSideProps = async () => {
        const serializedState = JSON.parse(JSON.stringify(state));
        recordSnapshot(serializedState);
        return { props: { serializedState } };
      };
      `,
      { filename: "/repo/src/pages/settings.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a page-data lookalike outside a Next.js pages directory", () => {
    const result = runRule(
      noJsonParseStringifyClone,
      `
      export const getServerSideProps = async () => ({
        props: { state: JSON.parse(JSON.stringify(state)) },
      });
      `,
      { filename: "/repo/src/server/load-state.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
