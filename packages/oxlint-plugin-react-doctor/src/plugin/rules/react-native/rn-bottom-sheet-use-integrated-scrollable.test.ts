import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rnBottomSheetUseIntegratedScrollable } from "./rn-bottom-sheet-use-integrated-scrollable.js";

describe("rn-bottom-sheet-use-integrated-scrollable", () => {
  it("flags React Native scrollables in a BottomSheet static JSX tree", () => {
    const code = `
      import BottomSheet from "@gorhom/bottom-sheet";
      import { FlatList, ScrollView, SectionList, VirtualizedList } from "react-native";
      const Screen = () => (
        <BottomSheet>
          <>
            <ScrollView />
            <View><FlatList data={items} /></View>
            <SectionList sections={sections} />
            <VirtualizedList data={items} />
          </>
        </BottomSheet>
      );
    `;
    const result = runRule(rnBottomSheetUseIntegratedScrollable, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(4);
  });

  it("resolves aliases and namespace imports for sheets and scrollables", () => {
    const code = `
      import { BottomSheetModal as Modal } from "@gorhom/bottom-sheet";
      import * as Gorhom from "@gorhom/bottom-sheet";
      import { FlatList as NativeList } from "react-native";
      import * as Native from "react-native";
      const First = () => <Modal><NativeList data={items} /></Modal>;
      const Second = () => (
        <Gorhom.BottomSheet><Native.ScrollView /></Gorhom.BottomSheet>
      );
    `;
    const result = runRule(rnBottomSheetUseIntegratedScrollable, code);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("flags statically visible conditional and logical scrollable children", () => {
    const code = `
      import BottomSheet from "@gorhom/bottom-sheet";
      import { FlatList, ScrollView } from "react-native";
      const Screen = ({ visible, compact }) => (
        <BottomSheet>
          {visible && <ScrollView />}
          {compact ? <FlatList data={items} /> : null}
        </BottomSheet>
      );
    `;
    const result = runRule(rnBottomSheetUseIntegratedScrollable, code);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("collects scrollables selected by static conditional tests", () => {
    const code = `
      import BottomSheet from "@gorhom/bottom-sheet";
      import { ScrollView, View } from "react-native";
      const sideEffect = () => undefined;
      const Screen = () => (
        <BottomSheet>
          {true ? <ScrollView /> : <View />}
          {false ? <View /> : <ScrollView />}
          {(sideEffect(), true) ? <ScrollView /> : <View />}
        </BottomSheet>
      );
    `;
    const result = runRule(rnBottomSheetUseIntegratedScrollable, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(3);
  });

  it("ignores scrollables excluded by static conditional tests", () => {
    const code = `
      import BottomSheet from "@gorhom/bottom-sheet";
      import { ScrollView, View } from "react-native";
      const sideEffect = () => undefined;
      const Screen = () => (
        <BottomSheet>
          {false ? <ScrollView /> : <View />}
          {true ? <View /> : <ScrollView />}
          {(sideEffect(), false) ? <ScrollView /> : <View />}
        </BottomSheet>
      );
    `;
    const result = runRule(rnBottomSheetUseIntegratedScrollable, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("collects both branches of dynamic conditional tests", () => {
    const code = `
      import BottomSheet from "@gorhom/bottom-sheet";
      import { FlatList, ScrollView } from "react-native";
      const Screen = ({ useList }) => (
        <BottomSheet>
          {useList ? <FlatList data={items} /> : <ScrollView />}
        </BottomSheet>
      );
    `;
    const result = runRule(rnBottomSheetUseIntegratedScrollable, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("ignores JSX discarded before the final sequence value", () => {
    const code = `
      import BottomSheet from "@gorhom/bottom-sheet";
      import { FlatList } from "react-native";
      const Screen = () => (
        <BottomSheet>
          {visible && (<FlatList data={items} />, null)}
        </BottomSheet>
      );
    `;
    const result = runRule(rnBottomSheetUseIntegratedScrollable, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("collects JSX returned by the final sequence value", () => {
    const code = `
      import BottomSheet from "@gorhom/bottom-sheet";
      import { FlatList } from "react-native";
      const Screen = () => (
        <BottomSheet>
          {visible && (null, <FlatList data={items} />)}
        </BottomSheet>
      );
    `;
    const result = runRule(rnBottomSheetUseIntegratedScrollable, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("ignores scrollables discarded by static JSX short-circuit operands", () => {
    const code = `
      import BottomSheet from "@gorhom/bottom-sheet";
      import { ScrollView, View } from "react-native";
      const sideEffect = () => undefined;
      const Screen = ({ condition }) => (
        <BottomSheet>
          {<ScrollView /> && <View />}
          {<View /> || <ScrollView />}
          {<View /> ?? <ScrollView />}
          {(sideEffect(), <View />) || <ScrollView />}
          {condition && <ScrollView /> && <View />}
          {condition || <View /> || <ScrollView />}
          {condition ?? <View /> ?? <ScrollView />}
          {condition || (<ScrollView /> && <View />)}
          {false && <ScrollView />}
          {true || <ScrollView />}
          {false ?? <ScrollView />}
        </BottomSheet>
      );
    `;
    const result = runRule(rnBottomSheetUseIntegratedScrollable, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("collects scrollables selected by static JSX short-circuit operands", () => {
    const code = `
      import BottomSheet from "@gorhom/bottom-sheet";
      import { ScrollView, View } from "react-native";
      const sideEffect = () => undefined;
      const Screen = ({ condition }) => (
        <BottomSheet>
          {<View /> && <ScrollView />}
          {<ScrollView /> || <View />}
          {<ScrollView /> ?? <View />}
          {(sideEffect(), <View />) && <ScrollView />}
          {condition && <View /> && <ScrollView />}
          {condition || <ScrollView /> || <View />}
          {condition ?? <ScrollView /> ?? <View />}
          {condition || (<View /> && <ScrollView />)}
          {true && <ScrollView />}
          {false || <ScrollView />}
          {null ?? <ScrollView />}
        </BottomSheet>
      );
    `;
    const result = runRule(rnBottomSheetUseIntegratedScrollable, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(11);
  });

  it("reports a scrollable only once when Bottom Sheets are nested", () => {
    const code = `
      import BottomSheet from "@gorhom/bottom-sheet";
      import { FlatList } from "react-native";
      const Screen = () => (
        <BottomSheet><BottomSheet><FlatList data={items} /></BottomSheet></BottomSheet>
      );
    `;
    const result = runRule(rnBottomSheetUseIntegratedScrollable, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows Gorhom integrated scrollables", () => {
    const code = `
      import BottomSheet, {
        BottomSheetFlatList,
        BottomSheetScrollView,
        BottomSheetSectionList,
        BottomSheetVirtualizedList,
      } from "@gorhom/bottom-sheet";
      const Screen = () => (
        <BottomSheet>
          <BottomSheetScrollView />
          <BottomSheetFlatList data={items} />
          <BottomSheetSectionList sections={sections} />
          <BottomSheetVirtualizedList data={items} />
        </BottomSheet>
      );
    `;
    const result = runRule(rnBottomSheetUseIntegratedScrollable, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not infer scrollables hidden behind an imported wrapper", () => {
    const code = `
      import BottomSheet from "@gorhom/bottom-sheet";
      import { SheetContent } from "./sheet-content";
      const Screen = () => <BottomSheet><SheetContent /></BottomSheet>;
    `;
    const result = runRule(rnBottomSheetUseIntegratedScrollable, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not inspect render props or function-valued children", () => {
    const code = `
      import BottomSheet from "@gorhom/bottom-sheet";
      import { FlatList } from "react-native";
      const Screen = () => (
        <BottomSheet renderBackdrop={() => <FlatList data={items} />}>
          {() => <FlatList data={items} />}
        </BottomSheet>
      );
    `;
    const result = runRule(rnBottomSheetUseIntegratedScrollable, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows a React Native scrollable outside a Bottom Sheet", () => {
    const code = `
      import BottomSheet from "@gorhom/bottom-sheet";
      import { FlatList } from "react-native";
      const Screen = () => <><BottomSheet /><FlatList data={items} /></>;
    `;
    const result = runRule(rnBottomSheetUseIntegratedScrollable, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores same-named components from unrelated modules", () => {
    const code = `
      import BottomSheet from "./bottom-sheet";
      import { FlatList } from "./flat-list";
      const Screen = () => <BottomSheet><FlatList /></BottomSheet>;
    `;
    const result = runRule(rnBottomSheetUseIntegratedScrollable, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores locally shadowed sheet and scrollable imports", () => {
    const code = `
      import BottomSheet from "@gorhom/bottom-sheet";
      import { FlatList } from "react-native";
      const ShadowedSheet = ({ BottomSheet }) => <BottomSheet><FlatList /></BottomSheet>;
      const ShadowedList = ({ FlatList }) => <BottomSheet><FlatList /></BottomSheet>;
    `;
    const result = runRule(rnBottomSheetUseIntegratedScrollable, code);
    expect(result.diagnostics).toHaveLength(0);
  });
});
