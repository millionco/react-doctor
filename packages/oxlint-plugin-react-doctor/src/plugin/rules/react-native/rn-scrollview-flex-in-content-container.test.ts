import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rnScrollviewFlexInContentContainer } from "./rn-scrollview-flex-in-content-container.js";

describe("rn-scrollview-flex-in-content-container", () => {
  it("flags flex: 1 on ScrollView contentContainerStyle", () => {
    const code = `
      const Screen = () => <ScrollView contentContainerStyle={{ flex: 1 }} />;
    `;
    const result = runRule(rnScrollviewFlexInContentContainer, code);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("collapse the container");
  });

  it("flags flex: 2 (any positive number)", () => {
    const code = `
      const Screen = () => <ScrollView contentContainerStyle={{ flex: 2, padding: 16 }} />;
    `;
    const result = runRule(rnScrollviewFlexInContentContainer, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags flex: 1 on FlatList contentContainerStyle", () => {
    const code = `
      const Screen = () => (
        <FlatList data={items} renderItem={renderItem} contentContainerStyle={{ flex: 1 }} />
      );
    `;
    const result = runRule(rnScrollviewFlexInContentContainer, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags flex: 1 on FlashList contentContainerStyle", () => {
    const code = `
      const Screen = () => (
        <FlashList data={items} renderItem={renderItem} contentContainerStyle={{ flex: 1 }} />
      );
    `;
    const result = runRule(rnScrollviewFlexInContentContainer, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags flex: 1 on SectionList contentContainerStyle", () => {
    const code = `
      const Screen = () => (
        <SectionList sections={sections} contentContainerStyle={{ flex: 1 }} />
      );
    `;
    const result = runRule(rnScrollviewFlexInContentContainer, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags flex: 1 on KeyboardAwareScrollView", () => {
    const code = `
      const Screen = () => (
        <KeyboardAwareScrollView contentContainerStyle={{ flex: 1 }} />
      );
    `;
    const result = runRule(rnScrollviewFlexInContentContainer, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does NOT flag flexGrow: 1 (the correct fix)", () => {
    const code = `
      const Screen = () => <ScrollView contentContainerStyle={{ flexGrow: 1 }} />;
    `;
    const result = runRule(rnScrollviewFlexInContentContainer, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag flex: 0 (intentional 'non-flexible' RN mode)", () => {
    const code = `
      const Screen = () => <ScrollView contentContainerStyle={{ flex: 0 }} />;
    `;
    const result = runRule(rnScrollviewFlexInContentContainer, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag flex: -1 (RN-specific shrink-to-min mode)", () => {
    const code = `
      const Screen = () => <ScrollView contentContainerStyle={{ flex: -1 }} />;
    `;
    const result = runRule(rnScrollviewFlexInContentContainer, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag flex when paired with explicit flexGrow", () => {
    const code = `
      const Screen = () => (
        <ScrollView contentContainerStyle={{ flex: 1, flexGrow: 2 }} />
      );
    `;
    const result = runRule(rnScrollviewFlexInContentContainer, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag flex when paired with explicit flexBasis", () => {
    const code = `
      const Screen = () => (
        <ScrollView contentContainerStyle={{ flex: 1, flexBasis: 100 }} />
      );
    `;
    const result = runRule(rnScrollviewFlexInContentContainer, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag dynamic flex value (non-literal)", () => {
    const code = `
      const Screen = ({ value }) => (
        <ScrollView contentContainerStyle={{ flex: value }} />
      );
    `;
    const result = runRule(rnScrollviewFlexInContentContainer, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag flex: 1 on non-scrollview components", () => {
    const code = `
      const Screen = () => <View contentContainerStyle={{ flex: 1 }} />;
    `;
    const result = runRule(rnScrollviewFlexInContentContainer, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag contentContainerStyle without flex", () => {
    const code = `
      const Screen = () => (
        <ScrollView contentContainerStyle={{ padding: 16, backgroundColor: "red" }} />
      );
    `;
    const result = runRule(rnScrollviewFlexInContentContainer, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag ScrollView without contentContainerStyle", () => {
    const code = `const Screen = () => <ScrollView style={{ flex: 1 }} />;`;
    const result = runRule(rnScrollviewFlexInContentContainer, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags flex: 1 via StyleSheet.create ref (styles.container)", () => {
    const code = `
      const styles = StyleSheet.create({ container: { flex: 1 } });
      const Screen = () => (
        <ScrollView contentContainerStyle={styles.container} />
      );
    `;
    const result = runRule(rnScrollviewFlexInContentContainer, code);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("collapse the container");
  });

  it("flags flex: 1 via computed StyleSheet.create ref (styles['container'])", () => {
    const code = `
      const styles = StyleSheet.create({ container: { flex: 1 } });
      const Screen = () => (
        <ScrollView contentContainerStyle={styles["container"]} />
      );
    `;
    const result = runRule(rnScrollviewFlexInContentContainer, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does NOT flag styles.container that does not contain flex: 1", () => {
    const code = `
      const styles = StyleSheet.create({ container: { flexGrow: 1, padding: 16 } });
      const Screen = () => (
        <ScrollView contentContainerStyle={styles.container} />
      );
    `;
    const result = runRule(rnScrollviewFlexInContentContainer, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag styles.container that pairs flex with flexGrow override", () => {
    const code = `
      const styles = StyleSheet.create({
        container: { flex: 1, flexGrow: 2 }
      });
      const Screen = () => (
        <ScrollView contentContainerStyle={styles.container} />
      );
    `;
    const result = runRule(rnScrollviewFlexInContentContainer, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag styles.<missingKey> (key not found in stylesheet)", () => {
    const code = `
      const styles = StyleSheet.create({ container: { flex: 1 } });
      const Screen = () => (
        <ScrollView contentContainerStyle={styles.missing} />
      );
    `;
    const result = runRule(rnScrollviewFlexInContentContainer, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag identifier reference that isn't a StyleSheet.create call", () => {
    const code = `
      const styles = { container: { flex: 1 } };
      const Screen = () => (
        <ScrollView contentContainerStyle={styles.container} />
      );
    `;
    const result = runRule(rnScrollviewFlexInContentContainer, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag dynamic computed key (styles[key])", () => {
    const code = `
      const styles = StyleSheet.create({ container: { flex: 1 } });
      const Screen = ({ key }) => (
        <ScrollView contentContainerStyle={styles[key]} />
      );
    `;
    const result = runRule(rnScrollviewFlexInContentContainer, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag inside testlike file (tags: test-noise)", () => {
    const code = `const Screen = () => <ScrollView contentContainerStyle={{ flex: 1 }} />;`;
    const result = runRule(rnScrollviewFlexInContentContainer, code, {
      filename: "Screen.test.tsx",
    });
    expect(result.diagnostics).toHaveLength(0);
  });
});
