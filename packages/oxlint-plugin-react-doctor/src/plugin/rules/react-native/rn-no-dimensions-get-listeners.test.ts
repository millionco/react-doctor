import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rnNoDimensionsGet } from "./rn-no-dimensions-get.js";

const listenerOptions = {
  filename: "fixture.tsx",
  forceJsx: true,
  includeLocations: true,
  settings: {
    "react-doctor": {
      portedRuleMode: "curated",
      capabilities: ["react-native"],
    },
  },
};

describe("react-native/rn-no-dimensions-get supported subscriptions", () => {
  it.each([
    {
      name: "module subscription cleanup",
      code: 'import {Dimensions} from "react-native"; const subscription=Dimensions.addEventListener("change",()=>{}); export const stop=()=>subscription.remove();',
      expected: 0,
    },
    {
      name: "effect subscription cleanup",
      code: 'import {useEffect} from "react"; import {Dimensions} from "react-native"; export const Panel=()=>{useEffect(()=>{const subscription=Dimensions.addEventListener("change",()=>{});return()=>subscription.remove();},[]);return null;};',
      expected: 0,
    },
    {
      name: "renamed native import",
      code: 'import {Dimensions as DisplayDimensions} from "react-native"; export const listen=()=>DisplayDimensions.addEventListener("change",()=>{});',
      expected: 0,
    },
    {
      name: "native namespace",
      code: 'import * as Native from "react-native"; export const listen=()=>Native.Dimensions.addEventListener("change",()=>{});',
      expected: 0,
    },
    {
      name: "CJS named binding",
      code: 'const {Dimensions}=require("react-native"); const subscription=Dimensions.addEventListener("change",()=>{}); export const stop=()=>subscription.remove();',
      expected: 0,
    },
    {
      name: "foreign named provider",
      code: 'import {Dimensions} from "./display-store"; export const listen=()=>Dimensions.addEventListener("change",()=>{});',
      expected: 0,
    },
    {
      name: "local provider",
      code: 'const Dimensions={addEventListener:()=>({remove(){}})};export const subscription=Dimensions.addEventListener("change",()=>{});',
      expected: 0,
    },
    {
      name: "shadowed native binding",
      code: 'import {Dimensions} from "react-native";export const listen=(Dimensions)=>Dimensions.addEventListener("change",()=>{});',
      expected: 0,
    },
    {
      name: "render get retained",
      code: 'import {Dimensions,View} from "react-native";export const Panel=()=>{const width=Dimensions.get("window").width;return <View style={{width}}/>;};',
      expected: 1,
    },
    {
      name: "module get retained quiet",
      code: 'import {Dimensions} from "react-native";export const initial=Dimensions.get("window");',
      expected: 0,
    },
    {
      name: "static factory get retained quiet",
      code: 'import {Dimensions} from "react-native";import {makeStyles}from "./styles";export const useStyles=makeStyles(()=>({panel:{width:Dimensions.get("window").width}}));',
      expected: 0,
    },
    {
      name: "distinct get alongside supported listener",
      code: 'import {Dimensions} from "react-native";export const subscribe=()=>{const current=Dimensions.get("window");const subscription=Dimensions.addEventListener("change",()=>{});return {current,stop:()=>subscription.remove()};};',
      expected: 1,
    },
    {
      name: "computed listener remains quiet",
      code: 'import {Dimensions} from "react-native"; export const subscription=Dimensions["addEventListener"]("change",()=>{});',
      expected: 0,
    },
    {
      name: "optional listener remains quiet",
      code: 'import {Dimensions} from "react-native"; export const subscription=Dimensions?.addEventListener("change",()=>{});',
      expected: 0,
    },
    {
      name: "get within listener callback remains reportable",
      code: 'import {Dimensions} from "react-native"; export const subscription=Dimensions.addEventListener("change",()=>{ const current=Dimensions.get("window"); consume(current); });',
      expected: 1,
    },
    {
      name: "screen get remains reportable",
      code: 'import {Dimensions,View}from "react-native";export const Panel=()=>{const width=Dimensions.get("screen").width;return <View style={{width}}/>;};',
      expected: 1,
    },
  ])("$name", ({ code, expected }) => {
    const result = runRule(rnNoDimensionsGet, code, listenerOptions);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
});
