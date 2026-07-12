import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../test-utils/run-rule.js";
import { noManyBooleanProps } from "./architecture/no-many-boolean-props.js";
import { preferExplicitVariants } from "./architecture/prefer-explicit-variants.js";
import { jsIndexMaps } from "./js-performance/js-index-maps.js";
import { rerenderMemoWithDefaultValue } from "./performance/rerender-memo-with-default-value.js";
import { noPassDataToParent } from "./state-and-effects/no-pass-data-to-parent.js";
import { noPassLiveStateToParent } from "./state-and-effects/no-pass-live-state-to-parent.js";

describe("single rest-tuple parameter regressions", () => {
  it("preserves no-many-boolean-props diagnostics", () => {
    const result = runRule(
      noManyBooleanProps,
      `const Toggle = (...[{ isOpen, isLoading, hasIcon, canEdit }]: [Props]) => <div />;`,
      { filename: "fixture.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("preserves prefer-explicit-variants diagnostics", () => {
    const result = runRule(
      preferExplicitVariants,
      `const Composer = (...[{ isThread, isEditing }]: [Props]) => (
        <div>
          {isThread ? <ThreadHeader /> : <ChannelHeader />}
          {isEditing ? <EditForm /> : <MessageContent />}
        </div>
      );`,
      { filename: "fixture.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("preserves rerender-memo-with-default-value diagnostics", () => {
    const result = runRule(
      rerenderMemoWithDefaultValue,
      `import { useMemo } from "react";
const Chart = (...[{ places = [] }]: [Props]) => {
  const placeByKey = useMemo(() => new Map(places.map((place) => [place.key, place])), [places]);
  return <div>{placeByKey.size}</div>;
};`,
      { filename: "fixture.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("preserves no-pass-data-to-parent diagnostics", () => {
    const result = runRule(
      noPassDataToParent,
      `const Child = (...[props]: [Props]) => {
        const fetchedData = useSomeAPI();
        useEffect(() => { props.onLoaded(fetchedData); }, [props, fetchedData]);
        return null;
      };`,
      { filename: "fixture.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("preserves no-pass-live-state-to-parent diagnostics", () => {
    const result = runRule(
      noPassLiveStateToParent,
      `const Child = (...[props]: [Props]) => {
        const [results] = useState([]);
        useEffect(() => { props.search(results); }, [props, results]);
        return null;
      };`,
      { filename: "fixture.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("preserves js-index-maps diagnostics", () => {
    const result = runRule(
      jsIndexMaps,
      `function findUsers(ids, users) {
        for (const id of ids) users.find((...[user]: [User]) => user.id === id);
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps multi-argument rest tuples opaque", () => {
    const componentResult = runRule(
      noManyBooleanProps,
      `const Toggle = (...[{ isOpen, isLoading, hasIcon, canEdit }, mode]: [Props, string]) => <div>{mode}</div>;`,
      { filename: "fixture.tsx" },
    );
    const callbackResult = runRule(
      jsIndexMaps,
      `function findUsers(ids, users) {
        for (const id of ids) users.find((...[user, index]: [User, number]) => user.id === id);
      }`,
    );
    expect(componentResult.parseErrors).toEqual([]);
    expect(componentResult.diagnostics).toEqual([]);
    expect(callbackResult.parseErrors).toEqual([]);
    expect(callbackResult.diagnostics).toEqual([]);
  });
});
