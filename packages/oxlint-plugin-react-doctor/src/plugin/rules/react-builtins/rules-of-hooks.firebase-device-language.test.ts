import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rulesOfHooks } from "./rules-of-hooks.js";

const runTsx = (code: string) => runRule(rulesOfHooks, code, { filename: "fixture.tsx" });

describe("Firebase device-language API role", () => {
  it.each([
    {
      name: "firebase-auth-runtime-named",
      code: 'import {useDeviceLanguage} from "firebase/auth"; export const configure = async auth => {useDeviceLanguage(auth)};',
    },
    {
      name: "firebase-auth-renamed-named",
      code: 'import {useDeviceLanguage as useLanguage} from "firebase/auth"; export const configure = async auth => {useLanguage(auth)};',
    },
    {
      name: "reviewed-sdk-barrel-runtime-named",
      code: 'import {useDeviceLanguage} from "@react-native-firebase/app/dist/module/internal/web/firebaseAuth"; export const configure = async auth => {useDeviceLanguage(auth)};',
    },
    {
      name: "reviewed-sdk-barrel-renamed-named",
      code: 'import {useDeviceLanguage as useLanguage} from "@react-native-firebase/app/dist/module/internal/web/firebaseAuth"; export const configure = async auth => {useLanguage(auth)};',
    },
    {
      name: "bridge-method-key-does-not-shadow-import",
      code: 'import {useDeviceLanguage} from "@react-native-firebase/app/dist/module/internal/web/firebaseAuth"; export const bridge={useDeviceLanguage(auth){return Promise.resolve().then(async()=>{useDeviceLanguage(auth)})}};',
    },
    {
      name: "ordinary-utility-after-await",
      code: 'import {useDeviceLanguage as useLanguage} from "firebase/auth"; export const configure=async auth=>{await Promise.resolve();useLanguage(auth)};',
    },
  ])("recognizes the exact immutable named API binding: $name", ({ code }) => {
    const result = runTsx(code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    {
      name: "namespace-import",
      code: 'import * as authApi from "firebase/auth"; export const configure=async auth=>{authApi.useDeviceLanguage(auth)};',
    },
    {
      name: "parameter-shadow",
      code: 'import {useDeviceLanguage} from "firebase/auth"; export const configure=async(useDeviceLanguage)=>{useDeviceLanguage()};',
    },
  ])("preserves already-quiet syntax outside the named-import policy: $name", ({ code }) => {
    const result = runTsx(code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    {
      name: "react-hook-control",
      code: 'import {useState} from "react"; export const configure=async()=>{useState(0)};',
    },
    {
      name: "wrong-firebase-export",
      code: 'import {useIdentity} from "firebase/auth"; export const configure=async()=>{useIdentity()};',
    },
    {
      name: "other-firebase-subpath",
      code: 'import {useDeviceLanguage} from "firebase/auth/compat"; export const configure=async auth=>{useDeviceLanguage(auth)};',
    },
    {
      name: "lookalike-sdk-subpath",
      code: 'import {useDeviceLanguage} from "@react-native-firebase/app/other/firebaseAuth"; export const configure=async auth=>{useDeviceLanguage(auth)};',
    },
    {
      name: "unknown-package",
      code: 'import {useDeviceLanguage} from "unrelated-auth"; export const configure=async auth=>{useDeviceLanguage(auth)};',
    },
    {
      name: "user-local-barrel",
      code: 'import {useDeviceLanguage} from "./auth-api"; export const configure=async auth=>{useDeviceLanguage(auth)};',
    },
    {
      name: "default-import",
      code: 'import useDeviceLanguage from "firebase/auth"; export const configure=async auth=>{useDeviceLanguage(auth)};',
    },
    {
      name: "const-alias",
      code: 'import {useDeviceLanguage} from "firebase/auth"; const useLanguage=useDeviceLanguage; export const configure=async auth=>{useLanguage(auth)};',
    },
    {
      name: "declaration-type-import",
      code: 'import type {useDeviceLanguage} from "firebase/auth"; export const configure=async auth=>{useDeviceLanguage(auth)};',
    },
    {
      name: "specifier-type-import",
      code: 'import {type useDeviceLanguage} from "firebase/auth"; export const configure=async auth=>{useDeviceLanguage(auth)};',
    },
    {
      name: "local-function-same-name",
      code: 'import {useState} from "react"; const useDeviceLanguage=()=>useState(0); export const configure=async()=>{useDeviceLanguage()};',
    },
    {
      name: "assignment-write",
      code: 'import {useDeviceLanguage} from "firebase/auth"; useDeviceLanguage=replacement; export const configure=async auth=>{useDeviceLanguage(auth)};',
    },
    {
      name: "destructuring-write",
      code: 'import {useDeviceLanguage} from "firebase/auth"; ({next:useDeviceLanguage}=replacement); export const configure=async auth=>{useDeviceLanguage(auth)};',
    },
    {
      name: "loop-target-write",
      code: 'import {useDeviceLanguage} from "firebase/auth"; for(useDeviceLanguage of replacements){} export const configure=async auth=>{useDeviceLanguage(auth)};',
    },
    {
      name: "dynamic-import-destructure",
      code: 'export const configure=async auth=>{const {useDeviceLanguage}=await import("firebase/auth");useDeviceLanguage(auth)};',
    },
    {
      name: "does not combine the Firebase export with Vidstack source",
      code: 'import {useDeviceLanguage} from "vidstack"; export const configure=async auth=>{useDeviceLanguage(auth)};',
    },
    {
      name: "does not combine the Vidstack export with Firebase source",
      code: 'import {usePlyrLayoutClasses} from "firebase/auth"; export const configure=async element=>{usePlyrLayoutClasses(element)};',
    },
    {
      name: "keeps a genuine React Hook in the same module",
      code: 'import {useDeviceLanguage} from "firebase/auth"; import {useState} from "react"; export const configure=async auth=>{useDeviceLanguage(auth)}; export const Panel=()=>{if(ready)useState(0);return null};',
    },
  ])("preserves unproven binding or genuine Hook checks: $name", ({ code }) => {
    const result = runTsx(code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
