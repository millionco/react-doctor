import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rnNoLayoutAnimationInRender } from "./rn-no-layout-animation-in-render.js";

interface SyntheticLayoutAnimationCase {
  name: string;
  source: string;
  expectedCount: number;
}

const SYNTHETIC_CASES: SyntheticLayoutAnimationCase[] = [
  {
    name: "declines inline type subpath re-export side effects",
    source:
      'export { type Marker } from "react-native/Libraries/review-side-effect"; import {LayoutAnimation, View} from "react-native"; export const Tile = () => { LayoutAnimation.spring(); return <View />; };',
    expectedCount: 0,
  },
  {
    name: "declines explicit empty subpath re-export side effects",
    source:
      'export {} from "react-native/Libraries/review-side-effect"; import {LayoutAnimation, View} from "react-native"; export const Tile = () => { LayoutAnimation.spring(); return <View />; };',
    expectedCount: 0,
  },
  {
    name: "allows a wholly erased type-only subpath re-export",
    source:
      'export type { Marker } from "react-native/Libraries/review-side-effect"; import {LayoutAnimation, View} from "react-native"; export const Tile = () => { LayoutAnimation.spring(); return <View />; };',
    expectedCount: 1,
  },
  {
    name: "declines runtime subpath value re-export exposure",
    source:
      'export { Marker } from "react-native/Libraries/review-side-effect"; import {LayoutAnimation, View} from "react-native"; export const Tile = () => { LayoutAnimation.spring(); return <View />; };',
    expectedCount: 0,
  },
  {
    name: "allows inline type root re-export with an already loaded root provider",
    source:
      'export { type Marker } from "react-native"; import {LayoutAnimation, View} from "react-native"; export const Tile = () => { LayoutAnimation.spring(); return <View />; };',
    expectedCount: 1,
  },
  {
    name: "allows empty root re-export with an already loaded root provider",
    source:
      'export {} from "react-native"; import {LayoutAnimation, View} from "react-native"; export const Tile = () => { LayoutAnimation.spring(); return <View />; };',
    expectedCount: 1,
  },
  {
    name: "array pattern method replacement",
    source:
      'import { LayoutAnimation, View } from "react-native"; [LayoutAnimation.spring] = [() => {}]; export const Tile = () => { LayoutAnimation.spring(); return <View />; };',
    expectedCount: 0,
  },
  {
    name: "object pattern method replacement",
    source:
      'import { LayoutAnimation, View } from "react-native"; ({ replacement: LayoutAnimation.spring } = { replacement: () => {} }); export const Tile = () => { LayoutAnimation.spring(); return <View />; };',
    expectedCount: 0,
  },
  {
    name: "for of method replacement",
    source:
      'import { LayoutAnimation, View } from "react-native"; for (LayoutAnimation.spring of [() => {}]) {} export const Tile = () => { LayoutAnimation.spring(); return <View />; };',
    expectedCount: 0,
  },
  {
    name: "declines inline type subpath imports with retained module side effects",
    source:
      'import { type ViewProps } from "react-native/Libraries/Components/View/ViewPropTypes"; import { LayoutAnimation, View } from "react-native"; export const Tile = () => { LayoutAnimation.spring(); return <View />; };',
    expectedCount: 0,
  },
  {
    name: "whole type subpath inverse",
    source:
      'import type { ViewProps } from "react-native/Libraries/Components/View/ViewPropTypes"; import { LayoutAnimation, View } from "react-native"; export const Tile = () => { LayoutAnimation.spring(); return <View />; };',
    expectedCount: 1,
  },
  {
    name: "declines a defaulted assignment target",
    source:
      'import { LayoutAnimation, View } from "react-native"; [LayoutAnimation.spring = () => {}] = []; export const Tile = () => { LayoutAnimation.spring(); return <View />; };',
    expectedCount: 0,
  },
  {
    name: "declines a rest assignment target",
    source:
      'import { LayoutAnimation, View } from "react-native"; [...LayoutAnimation.spring] = []; export const Tile = () => { LayoutAnimation.spring(); return <View />; };',
    expectedCount: 0,
  },
  {
    name: "retains direct scheduling after a computed assignment key reads the method",
    source:
      'import { LayoutAnimation, View } from "react-native"; let target; ({ [String(LayoutAnimation.spring)]: target } = {}); export const Tile = () => { LayoutAnimation.spring(); return <View />; };',
    expectedCount: 1,
  },
  {
    name: "retains direct scheduling after a pattern default reads the method",
    source:
      'import { LayoutAnimation, View } from "react-native"; let target; [target = LayoutAnimation.spring] = []; export const Tile = () => { LayoutAnimation.spring(); return <View />; };',
    expectedCount: 1,
  },
  {
    name: "declines a bare runtime subpath import",
    source:
      'import "react-native/Libraries/LayoutAnimation/LayoutAnimation"; import { LayoutAnimation, View } from "react-native";  export const Tile = () => { LayoutAnimation.spring(); return <View />; };',
    expectedCount: 0,
  },
  {
    name: "declines a mixed runtime and inline type subpath import",
    source:
      'import { type ViewProps, View as NativeView } from "react-native/Libraries/Components/View/ViewPropTypes"; import { LayoutAnimation, View } from "react-native";  export const Tile = () => { LayoutAnimation.spring(); return <View />; };',
    expectedCount: 0,
  },
  {
    name: "reports direct configureNext scheduling",
    source:
      'import { LayoutAnimation, View } from "react-native"; const Tile = () => { LayoutAnimation.configureNext({duration: 160}); return <View />; };',
    expectedCount: 1,
  },
  {
    name: "reports direct easeInEaseOut scheduling",
    source:
      'import { LayoutAnimation, View } from "react-native"; const Tile = () => { LayoutAnimation.easeInEaseOut(); return <View />; };',
    expectedCount: 1,
  },
  {
    name: "reports direct linear scheduling",
    source:
      'import { LayoutAnimation, View } from "react-native"; const Tile = () => { LayoutAnimation.linear(); return <View />; };',
    expectedCount: 1,
  },
  {
    name: "reports direct spring scheduling",
    source:
      'import { LayoutAnimation, View } from "react-native"; const Tile = () => { LayoutAnimation.spring(); return <View />; };',
    expectedCount: 1,
  },
  {
    name: "resolves renamed named imports",
    source:
      'import { LayoutAnimation as Motion, View } from "react-native"; const Tile = () => { Motion.spring(); return <View />; };',
    expectedCount: 1,
  },
  {
    name: "declines outside narrow profile: resolves namespace provider",
    source:
      'import * as Native from "react-native"; const Tile = () => { Native.LayoutAnimation.linear(); return <Native.View />; };',
    expectedCount: 0,
  },
  {
    name: "declines outside narrow profile: resolves default namespace accessor",
    source:
      'import Native from "react-native"; const Tile = () => { Native.LayoutAnimation.spring(); return <Native.View />; };',
    expectedCount: 0,
  },
  {
    name: "declines outside narrow profile: resolves immutable object alias",
    source:
      'import { LayoutAnimation, View } from "react-native"; const Motion = LayoutAnimation; const Tile = () => { Motion.spring(); return <View />; };',
    expectedCount: 0,
  },
  {
    name: "declines outside narrow profile: resolves immutable object alias chain",
    source:
      'import { LayoutAnimation, View } from "react-native"; const Motion = LayoutAnimation; const Animation = Motion; const Tile = () => { Animation.linear(); return <View />; };',
    expectedCount: 0,
  },
  {
    name: "declines outside narrow profile: resolves immutable namespace alias",
    source:
      'import * as Native from "react-native"; const Platform = Native; const Tile = () => { Platform.LayoutAnimation.spring(); return <Native.View />; };',
    expectedCount: 0,
  },
  {
    name: "declines outside narrow profile: resolves immutable object from namespace",
    source:
      'import * as Native from "react-native"; const Motion = Native.LayoutAnimation; const Tile = () => { Motion.spring(); return <Native.View />; };',
    expectedCount: 0,
  },
  {
    name: "accepts literal bracket method",
    source:
      'import { LayoutAnimation, View } from "react-native"; const Tile = () => { LayoutAnimation["spring"](); return <View />; };',
    expectedCount: 1,
  },
  {
    name: "declines outside narrow profile: accepts literal bracket namespace accessor",
    source:
      'import * as Native from "react-native"; const Tile = () => { Native["LayoutAnimation"]["linear"](); return <Native.View />; };',
    expectedCount: 0,
  },
  {
    name: "accepts no-substitution template method",
    source:
      'import { LayoutAnimation, View } from "react-native"; const Tile = () => { LayoutAnimation[`spring`](); return <View />; };',
    expectedCount: 1,
  },
  {
    name: "unwraps assertion around direct imported receiver",
    source:
      'import { LayoutAnimation, View } from "react-native"; const Tile = () => { (LayoutAnimation as typeof LayoutAnimation).spring(); return <View />; };',
    expectedCount: 1,
  },
  {
    name: "recognizes direct function declaration",
    source:
      'import { LayoutAnimation, View } from "react-native"; function Tile() { LayoutAnimation.spring(); return <View />; }',
    expectedCount: 1,
  },
  {
    name: "recognizes anonymous default declaration",
    source:
      'import { LayoutAnimation, View } from "react-native"; export default function() { LayoutAnimation.spring(); return <View />; }',
    expectedCount: 1,
  },
  {
    name: "recognizes direct default arrow",
    source:
      'import { LayoutAnimation, View } from "react-native"; export default () => { LayoutAnimation.spring(); return <View />; };',
    expectedCount: 1,
  },
  {
    name: "recognizes named export",
    source:
      'import { LayoutAnimation, View } from "react-native"; export const Tile = () => { LayoutAnimation.spring(); return <View />; };',
    expectedCount: 1,
  },
  {
    name: "requires returned render output with createElement",
    source:
      'import React from "react"; import { LayoutAnimation, View } from "react-native"; const Tile = () => { LayoutAnimation.spring(); return React.createElement(View); };',
    expectedCount: 1,
  },
  {
    name: "recognizes returned fragment",
    source:
      'import { LayoutAnimation, View } from "react-native"; const Tile = () => { LayoutAnimation.spring(); return <><View /></>; };',
    expectedCount: 1,
  },
  {
    name: "declines outside narrow profile: reports reachable unknown conditional",
    source:
      'import { LayoutAnimation, View } from "react-native"; const Tile = ({visible}) => { if (visible) LayoutAnimation.spring(); return <View />; };',
    expectedCount: 0,
  },
  {
    name: "declines outside narrow profile: reports reachable conditional expression",
    source:
      'import { LayoutAnimation, View } from "react-native"; const Tile = ({visible}) => { visible ? LayoutAnimation.spring() : null; return <View />; };',
    expectedCount: 0,
  },
  {
    name: "declines outside narrow profile: reports direct call inside reachable loop",
    source:
      'import { LayoutAnimation, View } from "react-native"; const Tile = ({items}) => { for (const item of items) { LayoutAnimation.spring(); } return <View />; };',
    expectedCount: 0,
  },
  {
    name: "reports eager JSX expression call",
    source:
      'import { LayoutAnimation, View } from "react-native"; const Tile = () => <View>{LayoutAnimation.spring()}</View>;',
    expectedCount: 1,
  },
  {
    name: "reports every scheduling expression once",
    source:
      'import { LayoutAnimation, View } from "react-native"; const Tile = () => { LayoutAnimation.configureNext({duration: 160}); LayoutAnimation.easeInEaseOut(); LayoutAnimation.linear(); LayoutAnimation.spring(); return <View />; };',
    expectedCount: 4,
  },
  {
    name: "does not attribute completion callback to render",
    source:
      'import { LayoutAnimation, View } from "react-native"; const Tile = () => { LayoutAnimation.easeInEaseOut(() => LayoutAnimation.spring()); return <View />; };',
    expectedCount: 1,
  },
  {
    name: "declines unknown global provider",
    source: "const Tile = () => { LayoutAnimation.spring(); return <section />; };",
    expectedCount: 0,
  },
  {
    name: "declines same-named other package",
    source:
      'import { LayoutAnimation } from "other-animation"; const Tile = () => { LayoutAnimation.spring(); return <section />; };',
    expectedCount: 0,
  },
  {
    name: "declines default import as provider object",
    source:
      'import LayoutAnimation from "react-native"; const Tile = () => { LayoutAnimation.spring(); return <section />; };',
    expectedCount: 0,
  },
  {
    name: "declines type-only named import",
    source:
      'import type { LayoutAnimation } from "react-native"; const Tile = () => { LayoutAnimation.spring(); return <section />; };',
    expectedCount: 0,
  },
  {
    name: "declines inline type-only named import",
    source:
      'import { type LayoutAnimation } from "react-native"; const Tile = () => { LayoutAnimation.spring(); return <section />; };',
    expectedCount: 0,
  },
  {
    name: "declines type-only namespace import",
    source:
      'import type * as Native from "react-native"; const Tile = () => { Native.LayoutAnimation.spring(); return <section />; };',
    expectedCount: 0,
  },
  {
    name: "declines shadowed imported binding",
    source:
      'import { LayoutAnimation, View } from "react-native"; const Tile = ({LayoutAnimation}) => { LayoutAnimation.spring(); return <View />; };',
    expectedCount: 0,
  },
  {
    name: "declines shadowed namespace binding",
    source:
      'import * as Native from "react-native"; const Tile = (Native) => { Native.LayoutAnimation.spring(); return <section />; };',
    expectedCount: 0,
  },
  {
    name: "declines locally constructed lookalike",
    source:
      "const LayoutAnimation = { spring() {} }; const Tile = () => { LayoutAnimation.spring(); return <section />; };",
    expectedCount: 0,
  },
  {
    name: "declines mutable object alias",
    source:
      'import { LayoutAnimation, View } from "react-native"; let Motion = LayoutAnimation; const Tile = () => { Motion.spring(); return <View />; };',
    expectedCount: 0,
  },
  {
    name: "declines destructured object alias in first profile",
    source:
      'import * as Native from "react-native"; const {LayoutAnimation: Motion} = Native; const Tile = () => { Motion.spring(); return <Native.View />; };',
    expectedCount: 0,
  },
  {
    name: "declines extracted callable alias",
    source:
      'import { LayoutAnimation, View } from "react-native"; const animate = LayoutAnimation.spring; const Tile = () => { animate(); return <View />; };',
    expectedCount: 0,
  },
  {
    name: "declines dynamic method name",
    source:
      'import { LayoutAnimation, View } from "react-native"; const Tile = ({method}) => { LayoutAnimation[method](); return <View />; };',
    expectedCount: 0,
  },
  {
    name: "declines constant computed method outside literal profile",
    source:
      'import { LayoutAnimation, View } from "react-native"; const method = "spring"; const Tile = () => { LayoutAnimation[method](); return <View />; };',
    expectedCount: 0,
  },
  {
    name: "declines unknown method",
    source:
      'import { LayoutAnimation, View } from "react-native"; const Tile = () => { LayoutAnimation.bounce(); return <View />; };',
    expectedCount: 0,
  },
  {
    name: "allows configuration construction",
    source:
      'import { LayoutAnimation, View } from "react-native"; const Tile = () => { const config = LayoutAnimation.create(160, "linear", "opacity"); return <View />; };',
    expectedCount: 0,
  },
  {
    name: "allows preset reads",
    source:
      'import { LayoutAnimation, View } from "react-native"; const Tile = () => <View config={LayoutAnimation.Presets.spring} />;',
    expectedCount: 0,
  },
  {
    name: "allows effect callback scheduling",
    source:
      'import {useEffect} from "react"; import { LayoutAnimation, View } from "react-native"; const Tile = () => { useEffect(() => { LayoutAnimation.spring(); }, []); return <View />; };',
    expectedCount: 0,
  },
  {
    name: "allows event callback scheduling",
    source:
      'import { LayoutAnimation, View } from "react-native"; const Tile = () => <View onTouchEnd={() => LayoutAnimation.spring()} />;',
    expectedCount: 0,
  },
  {
    name: "declines custom hook body",
    source:
      'import { LayoutAnimation, View } from "react-native"; const useMotion = () => { LayoutAnimation.spring(); return <View />; };',
    expectedCount: 0,
  },
  {
    name: "declines module scope call",
    source:
      'import { LayoutAnimation, View } from "react-native"; LayoutAnimation.spring(); export const Tile = () => <View />;',
    expectedCount: 0,
  },
  {
    name: "declines lowercase helper even when called by component",
    source:
      'import { LayoutAnimation, View } from "react-native"; const animate = () => { LayoutAnimation.spring(); return <View />; }; const Tile = () => animate();',
    expectedCount: 0,
  },
  {
    name: "declines useMemo callback",
    source:
      'import {useMemo} from "react"; import { LayoutAnimation, View } from "react-native"; const Tile = () => useMemo(() => { LayoutAnimation.spring(); return <View />; }, []);',
    expectedCount: 0,
  },
  {
    name: "declines higher-order wrapper callback",
    source:
      'import {memo} from "react"; import { LayoutAnimation, View } from "react-native"; const Tile = memo(() => { LayoutAnimation.spring(); return <View />; });',
    expectedCount: 0,
  },
  {
    name: "declines unknown wrapper callback",
    source:
      'import { LayoutAnimation, View } from "react-native"; const Tile = decorate(() => { LayoutAnimation.spring(); return <View />; });',
    expectedCount: 0,
  },
  {
    name: "declines class render method",
    source:
      'import React from "react"; import { LayoutAnimation, View } from "react-native"; class Tile extends React.Component { render() { LayoutAnimation.spring(); return <View />; } }',
    expectedCount: 0,
  },
  {
    name: "declines object method",
    source:
      'import { LayoutAnimation, View } from "react-native"; const factory = { Tile() { LayoutAnimation.spring(); return <View />; } };',
    expectedCount: 0,
  },
  {
    name: "declines nested component definition",
    source:
      'import { LayoutAnimation, View } from "react-native"; const Panel = () => { const Tile = () => { LayoutAnimation.spring(); return <View />; }; return <Tile />; };',
    expectedCount: 0,
  },
  {
    name: "declines immediate function callback",
    source:
      'import { LayoutAnimation, View } from "react-native"; const Tile = () => { (() => { LayoutAnimation.spring(); })(); return <View />; };',
    expectedCount: 0,
  },
  {
    name: "declines async component profile",
    source:
      'import { LayoutAnimation, View } from "react-native"; const Tile = async () => { LayoutAnimation.spring(); return <View />; };',
    expectedCount: 0,
  },
  {
    name: "declines generator component profile",
    source:
      'import { LayoutAnimation, View } from "react-native"; function* Tile() { LayoutAnimation.spring(); return <View />; }',
    expectedCount: 0,
  },
  {
    name: "declines factory without render output",
    source:
      'import { LayoutAnimation, View } from "react-native"; const Tile = () => { LayoutAnimation.spring(); return {}; };',
    expectedCount: 0,
  },
  {
    name: "declines null-only component without output evidence",
    source:
      'import { LayoutAnimation, View } from "react-native"; const Tile = () => { LayoutAnimation.spring(); return null; };',
    expectedCount: 0,
  },
  {
    name: "declines optional method call",
    source:
      'import { LayoutAnimation, View } from "react-native"; const Tile = () => { LayoutAnimation.spring?.(); return <View />; };',
    expectedCount: 0,
  },
  {
    name: "declines optional receiver call",
    source:
      'import { LayoutAnimation, View } from "react-native"; const Tile = () => { LayoutAnimation?.spring(); return <View />; };',
    expectedCount: 0,
  },
  {
    name: "declines literal false branch",
    source:
      'import { LayoutAnimation, View } from "react-native"; const Tile = () => { if (false) LayoutAnimation.spring(); return <View />; };',
    expectedCount: 0,
  },
  {
    name: "declines literal true alternate",
    source:
      'import { LayoutAnimation, View } from "react-native"; const Tile = () => { if (true) {} else LayoutAnimation.spring(); return <View />; };',
    expectedCount: 0,
  },
  {
    name: "declines literal dead conditional arm",
    source:
      'import { LayoutAnimation, View } from "react-native"; const Tile = () => { false ? LayoutAnimation.spring() : null; return <View />; };',
    expectedCount: 0,
  },
  {
    name: "declines false logical operand",
    source:
      'import { LayoutAnimation, View } from "react-native"; const Tile = () => { false && LayoutAnimation.spring(); return <View />; };',
    expectedCount: 0,
  },
  {
    name: "declines true logical alternative",
    source:
      'import { LayoutAnimation, View } from "react-native"; const Tile = () => { true || LayoutAnimation.spring(); return <View />; };',
    expectedCount: 0,
  },
  {
    name: "declines false while body",
    source:
      'import { LayoutAnimation, View } from "react-native"; const Tile = () => { while (false) LayoutAnimation.spring(); return <View />; };',
    expectedCount: 0,
  },
  {
    name: "declines false for body",
    source:
      'import { LayoutAnimation, View } from "react-native"; const Tile = () => { for (;false;) LayoutAnimation.spring(); return <View />; };',
    expectedCount: 0,
  },
  {
    name: "declines statement after unconditional return",
    source:
      'import { LayoutAnimation, View } from "react-native"; const Tile = () => { return <View />; LayoutAnimation.spring(); };',
    expectedCount: 0,
  },
  {
    name: "declines module method replacement",
    source:
      'import { LayoutAnimation, View } from "react-native"; LayoutAnimation.spring = () => {}; const Tile = () => { LayoutAnimation.spring(); return <View />; };',
    expectedCount: 0,
  },
  {
    name: "declines replacement through immutable alias",
    source:
      'import { LayoutAnimation, View } from "react-native"; const Motion = LayoutAnimation; Motion.spring = () => {}; const Tile = () => { LayoutAnimation.spring(); return <View />; };',
    expectedCount: 0,
  },
  {
    name: "declines namespace method replacement",
    source:
      'import * as Native from "react-native"; Native.LayoutAnimation.spring = () => {}; const Tile = () => { Native.LayoutAnimation.spring(); return <Native.View />; };',
    expectedCount: 0,
  },
  {
    name: "declines namespace provider replacement",
    source:
      'import * as Native from "react-native"; Native.LayoutAnimation = other; const Tile = () => { Native.LayoutAnimation.spring(); return <Native.View />; };',
    expectedCount: 0,
  },
  {
    name: "declines method deletion",
    source:
      'import { LayoutAnimation, View } from "react-native"; delete LayoutAnimation.spring; const Tile = () => { LayoutAnimation.spring(); return <View />; };',
    expectedCount: 0,
  },
  {
    name: "declines computed provider write",
    source:
      'import { LayoutAnimation, View } from "react-native"; LayoutAnimation[method] = () => {}; const Tile = () => { LayoutAnimation.spring(); return <View />; };',
    expectedCount: 0,
  },
  {
    name: "declines property mutation through reflection",
    source:
      'import { LayoutAnimation, View } from "react-native"; Object.defineProperty(LayoutAnimation, "spring", {value() {}}); const Tile = () => { LayoutAnimation.spring(); return <View />; };',
    expectedCount: 0,
  },
  {
    name: "declines named provider escape",
    source:
      'import { LayoutAnimation, View } from "react-native"; accept(LayoutAnimation); const Tile = () => { LayoutAnimation.spring(); return <View />; };',
    expectedCount: 0,
  },
  {
    name: "declines namespace provider escape",
    source:
      'import * as Native from "react-native"; accept(Native.LayoutAnimation); const Tile = () => { Native.LayoutAnimation.spring(); return <Native.View />; };',
    expectedCount: 0,
  },
  {
    name: "conservatively declines later file mutation",
    source:
      'import { LayoutAnimation, View } from "react-native"; const Tile = () => { LayoutAnimation.spring(); return <View />; }; const replace = () => { LayoutAnimation.spring = () => {}; };',
    expectedCount: 0,
  },
  {
    name: "declines component parameter initializer outside body profile",
    source:
      'import { LayoutAnimation, View } from "react-native"; const Tile = ({value = LayoutAnimation.spring()}) => <View />;',
    expectedCount: 0,
  },
  {
    name: "declines namespace object passed to unknown code",
    source:
      'import * as Native from "react-native"; accept(Native); const Tile = () => { Native.LayoutAnimation.spring(); return <Native.View />; };',
    expectedCount: 0,
  },
  {
    name: "declines synchronously invoked local helper outside direct profile",
    source:
      'import { LayoutAnimation, View } from "react-native"; const Tile = () => { const animate = () => LayoutAnimation.spring(); animate(); return <View />; };',
    expectedCount: 0,
  },
  {
    name: "declines namespace stored in an opaque container",
    source:
      'import * as Native from "react-native"; const holder = {Native}; accept(holder); const Tile = () => { Native.LayoutAnimation.spring(); return <Native.View />; };',
    expectedCount: 0,
  },
  {
    name: "declines named JSX-returning event callback",
    source:
      'import {LayoutAnimation, View, Pressable} from "react-native"; const BuildPreview = () => { LayoutAnimation.spring(); return <View />; }; const Screen = () => <Pressable onPress={BuildPreview} />;',
    expectedCount: 0,
  },
  {
    name: "declines named JSX-returning effect callback",
    source:
      'import {useEffect} from "react"; import {LayoutAnimation, View, Pressable} from "react-native"; const BuildPreview = () => { LayoutAnimation.spring(); return <View />; }; const Screen = () => { useEffect(BuildPreview, []); return <View />; };',
    expectedCount: 0,
  },
  {
    name: "declines named JSX-returning timer callback",
    source:
      'import {LayoutAnimation, View, Pressable} from "react-native"; const BuildPreview = () => { LayoutAnimation.spring(); return <View />; }; setTimeout(BuildPreview, 80);',
    expectedCount: 0,
  },
  {
    name: "declines named JSX-returning ordinary direct call",
    source:
      'import {LayoutAnimation, View, Pressable} from "react-native"; const BuildPreview = () => { LayoutAnimation.spring(); return <View />; }; const preview = BuildPreview();',
    expectedCount: 0,
  },
  {
    name: "declines named function passed to higher-order wrapper",
    source:
      'import {memo} from "react"; import {LayoutAnimation, View, Pressable} from "react-native"; const Tile = () => { LayoutAnimation.spring(); return <View />; }; const Wrapped = memo(Tile);',
    expectedCount: 0,
  },
  {
    name: "declines mixed JSX and ordinary component references",
    source:
      'import {LayoutAnimation, View, Pressable} from "react-native"; const Tile = () => { LayoutAnimation.spring(); return <View />; }; const Screen = () => <><Tile /><Pressable onPress={Tile} /></>;',
    expectedCount: 0,
  },
  {
    name: "declines component value alias",
    source:
      'import {LayoutAnimation, View, Pressable} from "react-native"; const Tile = () => { LayoutAnimation.spring(); return <View />; }; const factory = Tile;',
    expectedCount: 0,
  },
  {
    name: "allows separately default-exported component reference",
    source:
      'import {LayoutAnimation, View, Pressable} from "react-native"; const Tile = () => { LayoutAnimation.spring(); return <View />; }; export default Tile;',
    expectedCount: 1,
  },
  {
    name: "declines createElement component reference outside JSX-only use fence",
    source:
      'import React from "react"; import {LayoutAnimation, View, Pressable} from "react-native"; const Tile = () => { LayoutAnimation.spring(); return <View />; }; const Screen = () => React.createElement(Tile);',
    expectedCount: 0,
  },
  {
    name: "accepts component with direct JSX references",
    source:
      'import {LayoutAnimation, View, Pressable} from "react-native"; const Tile = () => { LayoutAnimation.spring(); return <View />; }; const Screen = () => <Tile />;',
    expectedCount: 1,
  },
  {
    name: "accepts opening and closing JSX references",
    source:
      'import {LayoutAnimation, View, Pressable} from "react-native"; function Tile() { LayoutAnimation.spring(); return <View />; } const Screen = () => <Tile></Tile>;',
    expectedCount: 1,
  },
  {
    name: "declines exported const provider alias",
    source:
      'import {LayoutAnimation, View, Pressable} from "react-native"; export const escaped = LayoutAnimation; export const Tile = () => { LayoutAnimation.spring(); return <View />; };',
    expectedCount: 0,
  },
  {
    name: "declines provider export specifier",
    source:
      'import {LayoutAnimation, View, Pressable} from "react-native"; export {LayoutAnimation as escaped}; const Tile = () => { LayoutAnimation.spring(); return <View />; };',
    expectedCount: 0,
  },
  {
    name: "declines provider stored in an opaque container",
    source:
      'import {LayoutAnimation, View, Pressable} from "react-native"; const holder = {LayoutAnimation}; accept(holder); const Tile = () => { LayoutAnimation.spring(); return <View />; };',
    expectedCount: 0,
  },
  {
    name: "declines namespace mutation affecting named provider",
    source:
      'import * as Native from "react-native"; import {LayoutAnimation, View, Pressable} from "react-native"; Native.LayoutAnimation.spring = () => {}; const Tile = () => { LayoutAnimation.spring(); return <View />; };',
    expectedCount: 0,
  },
  {
    name: "declines default namespace reflection affecting named provider",
    source:
      'import Native from "react-native"; import {LayoutAnimation, View, Pressable} from "react-native"; Object.assign(Native.LayoutAnimation, {spring: () => {}}); const Tile = () => { LayoutAnimation.spring(); return <View />; };',
    expectedCount: 0,
  },
  {
    name: "declines namespace alias reflection affecting named provider",
    source:
      'import * as Native from "react-native"; import {LayoutAnimation, View, Pressable} from "react-native"; const Motion = Native.LayoutAnimation; Object.assign(Motion, {spring: () => {}}); const Tile = () => { LayoutAnimation.spring(); return <View />; };',
    expectedCount: 0,
  },
  {
    name: "declines duplicate named import mutation",
    source:
      'import {LayoutAnimation as Primary, LayoutAnimation as Mutable, View} from "react-native"; Mutable.linear = () => {}; const Tile = () => { Primary.linear(); return <View />; };',
    expectedCount: 0,
  },
  {
    name: "declines duplicate named import reflection",
    source:
      'import {LayoutAnimation as Primary, LayoutAnimation as Mutable, View} from "react-native"; Object.assign(Mutable, {linear: () => {}}); const Tile = () => { Primary.linear(); return <View />; };',
    expectedCount: 0,
  },
  {
    name: "declines transitive destructuring aliases",
    source:
      'import * as Native from "react-native"; const {LayoutAnimation: Motion} = Native; const Alias = Motion; const Tile = () => { Alias.spring(); return <Native.View />; };',
    expectedCount: 0,
  },
  {
    name: "declines dead numeric if body",
    source:
      'import {LayoutAnimation, View, Pressable} from "react-native"; const Tile = () => { if (0) LayoutAnimation.spring(); return <View />; };',
    expectedCount: 0,
  },
  {
    name: "declines dead numeric conditional arm",
    source:
      'import {LayoutAnimation, View, Pressable} from "react-native"; const Tile = () => { 0 ? LayoutAnimation.spring() : null; return <View />; };',
    expectedCount: 0,
  },
  {
    name: "declines nonnull nullish alternative",
    source:
      'import {LayoutAnimation, View, Pressable} from "react-native"; const Tile = () => { 1 ?? LayoutAnimation.spring(); return <View />; };',
    expectedCount: 0,
  },
  {
    name: "declines try-finally profile",
    source:
      'import {LayoutAnimation, View, Pressable} from "react-native"; const Tile = () => { try { LayoutAnimation.spring(); } finally {} return <View />; };',
    expectedCount: 0,
  },
  {
    name: "declines switch profile",
    source:
      'import {LayoutAnimation, View, Pressable} from "react-native"; const Tile = ({mode}) => { switch (mode) { case "active": LayoutAnimation.spring(); } return <View />; };',
    expectedCount: 0,
  },
  {
    name: "declines literal CommonJS provider exposure",
    source:
      'import {LayoutAnimation, View, Pressable} from "react-native"; const Native = require("react-native"); Object.assign(Native.LayoutAnimation, {spring: () => {}}); const Tile = () => { LayoutAnimation.spring(); return <View />; };',
    expectedCount: 0,
  },
  {
    name: "declines literal dynamic import provider exposure",
    source:
      'import {LayoutAnimation, View, Pressable} from "react-native"; import("react-native").then(accept); const Tile = () => { LayoutAnimation.spring(); return <View />; };',
    expectedCount: 0,
  },
  {
    name: "declines runtime native subpath provider exposure",
    source:
      'import {LayoutAnimation, View, Pressable} from "react-native"; import Motion from "react-native/Libraries/LayoutAnimation/LayoutAnimation"; accept(Motion); const Tile = () => { LayoutAnimation.spring(); return <View />; };',
    expectedCount: 0,
  },
  {
    name: "allows erased namespace alongside direct named import",
    source:
      'import type * as Native from "react-native"; import {LayoutAnimation, View, Pressable} from "react-native"; const Tile = () => { LayoutAnimation.spring(); return <View />; };',
    expectedCount: 1,
  },
  {
    name: "allows erased default alongside direct named import",
    source:
      'import type Native from "react-native"; import {LayoutAnimation, View, Pressable} from "react-native"; const Tile = () => { LayoutAnimation.spring(); return <View />; };',
    expectedCount: 1,
  },
  {
    name: "allows component local export specifier",
    source:
      'import {LayoutAnimation, View, Pressable} from "react-native"; const Tile = () => { LayoutAnimation.spring(); return <View />; }; export {Tile};',
    expectedCount: 1,
  },
  {
    name: "declines mixed component export and event callback",
    source:
      'import {LayoutAnimation, View, Pressable} from "react-native"; const Tile = () => { LayoutAnimation.spring(); return <View />; }; const Screen = () => <Pressable onPress={Tile} />; export default Tile;',
    expectedCount: 0,
  },
  {
    name: "declines named function expression with separate self binding",
    source:
      'import {LayoutAnimation, View, Pressable} from "react-native"; const Tile = function BuildPreview() { LayoutAnimation.spring(); return <View />; }; const Screen = () => <Tile />;',
    expectedCount: 0,
  },
  {
    name: "declines native source provider re-export",
    source:
      'import {LayoutAnimation as Motion, View} from "react-native"; export {LayoutAnimation as escaped} from "react-native"; const Tile = () => { Motion.spring(); return <View />; };',
    expectedCount: 0,
  },
  {
    name: "declines native export-all exposure",
    source:
      'import {LayoutAnimation as Motion, View} from "react-native"; export * from "react-native"; const Tile = () => { Motion.spring(); return <View />; };',
    expectedCount: 0,
  },
  {
    name: "allows erased native source re-export",
    source:
      'import {LayoutAnimation as Motion, View} from "react-native"; export type {LayoutAnimationConfig} from "react-native"; const Tile = () => { Motion.spring(); return <View />; };',
    expectedCount: 1,
  },
  {
    name: "allows inline erased native source re-export",
    source:
      'import {LayoutAnimation as Motion, View} from "react-native"; export {type LayoutAnimationConfig} from "react-native"; const Tile = () => { Motion.spring(); return <View />; };',
    expectedCount: 1,
  },
  {
    name: "declines deferred nested class instance field",
    source:
      'import {LayoutAnimation, View} from "react-native"; const Tile = () => { class Holder { animation = LayoutAnimation.linear(); } return <View />; };',
    expectedCount: 0,
  },
  {
    name: "declines nested class method body",
    source:
      'import {LayoutAnimation, View} from "react-native"; const Tile = () => { class Holder { animate() { LayoutAnimation.linear(); } } return <View />; };',
    expectedCount: 0,
  },
  {
    name: "declines nested class static initialization profile",
    source:
      'import {LayoutAnimation, View} from "react-native"; const Tile = () => { class Holder { static animation = LayoutAnimation.linear(); } return <View />; };',
    expectedCount: 0,
  },
  {
    name: "declines deferred class expression instance field",
    source:
      'import {LayoutAnimation, View} from "react-native"; const Tile = () => { const Holder = class { animation = LayoutAnimation.linear(); }; return <View />; };',
    expectedCount: 0,
  },
  {
    name: "declines class heritage profile",
    source:
      'import {LayoutAnimation, View} from "react-native"; const Tile = () => { class Holder extends (LayoutAnimation.linear(), Base) {} return <View />; };',
    expectedCount: 0,
  },
];

describe("rn-no-layout-animation-in-render", () => {
  it.each(SYNTHETIC_CASES)("$name", ({ source, expectedCount }) => {
    const result = runRule(rnNoLayoutAnimationInRender, source, {
      filename: "tile.tsx",
      settings: { "react-doctor": { capabilities: ["react-native"] } },
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedCount);
    for (const diagnostic of result.diagnostics) {
      expect(diagnostic.nodeType).toBe("MemberExpression");
      expect(diagnostic.message).toContain("is called during render");
    }
  });

  it("stays quiet when explicit capabilities exclude React Native", () => {
    const result = runRule(
      rnNoLayoutAnimationInRender,
      'import {LayoutAnimation, View} from "react-native"; const Tile = () => { LayoutAnimation.spring(); return <View />; };',
      { filename: "tile.tsx", settings: { "react-doctor": { capabilities: ["react"] } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("remains an explicit React Native warning opt-in", () => {
    expect(rnNoLayoutAnimationInRender.defaultEnabled).toBe(false);
    expect(rnNoLayoutAnimationInRender.severity).toBe("warn");
    expect(rnNoLayoutAnimationInRender.requires).toEqual(["react-native"]);
  });
});
