import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rnNoRenderitemKey } from "./rn-no-renderitem-key.js";

describe("rn-no-renderitem-key", () => {
  it("flags arrow concise body returning a JSX element with key on FlatList", () => {
    const code = `
      const App = ({ data }) => (
        <FlatList data={data} renderItem={({ item }) => <Row key={item.id} value={item.value} />} />
      );
    `;
    const result = runRule(rnNoRenderitemKey, code);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("renderItem");
    expect(result.diagnostics[0].message).toContain("the list ignores it");
  });

  it("flags arrow block body returning a JSX element with key", () => {
    const code = `
      const App = ({ data }) => (
        <FlatList
          data={data}
          renderItem={({ item }) => {
            return <Row key={item.id} value={item.value} />;
          }}
        />
      );
    `;
    const result = runRule(rnNoRenderitemKey, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags FunctionExpression returning a JSX element with key", () => {
    const code = `
      const App = ({ data }) => (
        <FlatList
          data={data}
          renderItem={function ({ item }) {
            return <Row key={item.id} />;
          }}
        />
      );
    `;
    const result = runRule(rnNoRenderitemKey, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags renderSectionHeader on SectionList", () => {
    const code = `
      const App = ({ sections }) => (
        <SectionList
          sections={sections}
          renderSectionHeader={({ section }) => <Header key={section.id} title={section.title} />}
          renderItem={({ item }) => <Row value={item.value} />}
        />
      );
    `;
    const result = runRule(rnNoRenderitemKey, code);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("renderSectionHeader");
  });

  it("flags FlashList renderItem with key", () => {
    const code = `
      const App = ({ data }) => (
        <FlashList data={data} renderItem={({ item }) => <Row key={item.id} />} />
      );
    `;
    const result = runRule(rnNoRenderitemKey, code);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("renderItem");
  });

  it("flags the JSX branch with key inside a ternary", () => {
    const code = `
      const App = ({ data }) => (
        <FlatList
          data={data}
          renderItem={({ item }) => (item.kind === "header" ? <Header key={item.id} /> : <Row value={item.value} />)}
        />
      );
    `;
    const result = runRule(rnNoRenderitemKey, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags the JSX wrapped in TS `as`", () => {
    const code = `
      const App = ({ data }) => (
        <FlatList
          data={data}
          renderItem={({ item }) => (<Row key={item.id} /> as React.ReactElement)}
        />
      );
    `;
    const result = runRule(rnNoRenderitemKey, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags multiple return paths independently", () => {
    const code = `
      const App = ({ data }) => (
        <FlatList
          data={data}
          renderItem={({ item }) => {
            if (item.kind === "header") return <Header key={item.id} />;
            return <Row key={item.id} value={item.value} />;
          }}
        />
      );
    `;
    const result = runRule(rnNoRenderitemKey, code);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("does NOT flag renderItem without a key prop", () => {
    const code = `
      const App = ({ data }) => (
        <FlatList data={data} renderItem={({ item }) => <Row value={item.value} />} />
      );
    `;
    const result = runRule(rnNoRenderitemKey, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag keys on descendants nested inside the returned row", () => {
    const code = `
      const App = ({ data }) => (
        <FlatList
          data={data}
          renderItem={({ item }) => (
            <View>
              {item.tags.map((tag) => (
                <Tag key={tag.id} value={tag} />
              ))}
            </View>
          )}
        />
      );
    `;
    const result = runRule(rnNoRenderitemKey, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag keys on JSX returned from a nested function inside renderItem", () => {
    const code = `
      const App = ({ data }) => (
        <FlatList
          data={data}
          renderItem={({ item }) => {
            const renderTag = (tag) => <Tag key={tag.id} value={tag} />;
            return <View>{item.tags.map(renderTag)}</View>;
          }}
        />
      );
    `;
    const result = runRule(rnNoRenderitemKey, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag a renderItem on a non-list component", () => {
    const code = `
      const App = ({ data }) => (
        <Carousel data={data} renderItem={({ item }) => <Slide key={item.id} />} />
      );
    `;
    const result = runRule(rnNoRenderitemKey, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag renderItem returning null", () => {
    const code = `
      const App = ({ data }) => (
        <FlatList data={data} renderItem={() => null} />
      );
    `;
    const result = runRule(rnNoRenderitemKey, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag mapped JSX outside of renderItem", () => {
    const code = `
      const App = ({ items }) => (
        <View>
          {items.map((item) => (
            <Row key={item.id} value={item.value} />
          ))}
        </View>
      );
    `;
    const result = runRule(rnNoRenderitemKey, code);
    expect(result.diagnostics).toHaveLength(0);
  });
});
