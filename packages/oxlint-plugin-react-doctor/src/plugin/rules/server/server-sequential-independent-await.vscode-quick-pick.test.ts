import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { serverSequentialIndependentAwait } from "./server-sequential-independent-await.js";

const quickPickPair = `
  const layout = await editorApi.window.showQuickPick(["Compact", "Expanded"]);
  const size = await editorApi.window.showQuickPick(["Small", "Large"]);
  return [layout, size];`;

describe("server-sequential-independent-await VS Code QuickPick", () => {
  it.each([
    `import * as editorApi from "vscode";
     export const choose = async () => {${quickPickPair}};`,
    `import * as editorApi from "vscode";
     export async function choose() {${quickPickPair}}`,
    `import type { QuickPickItem } from "unrelated-types";
     import * as editorApi from "vscode";
     export const choose = async () => {${quickPickPair}};`,
    `import fs = require("node:fs");
     import * as editorApi from "vscode";
     export const exists = fs.existsSync;
     export const choose = async () => {${quickPickPair}};`,
    `import type EditorTypes = require("vscode");
     import * as editorApi from "vscode";
     export interface Options { item: EditorTypes.QuickPickItem }
     export const choose = async () => {${quickPickPair}};`,
    `import * as editorApi from "vscode";
     import { createRequire as createLoader } from "node:module";
     const load = createLoader(__filename);
     export const readFile = load("node:fs").readFile;
     export const choose = async () => {${quickPickPair}};`,
    `import * as editorApi from "vscode";
     import * as nodeModule from "module";
     export const unrelated = (nodeModule) => nodeModule.createRequire(__filename)("vscode");
     export const choose = async () => {${quickPickPair}};`,
    `import * as editorApi from "vscode";
     import { Module as NodeModule } from "node:module";
     export const readFile = NodeModule.createRequire(import.meta.url)("node:" + "fs").readFile;
     export const choose = async () => {${quickPickPair}};`,
    `import * as editorApi from "vscode";
     import nodeModule = require("foreign-loader");
     const {Module: NodeModule} = nodeModule;
     NodeModule.createRequire(__filename)("vscode").window.showQuickPick = replacement;
     export const choose = async () => {${quickPickPair}};`,
    `import * as editorApi from "vscode";
     export const announce = () => editorApi.window.showInformationMessage("Ready");
     export const choose = async () => {${quickPickPair}};`,
    `import * as editorApi from "vscode";
     export const location = editorApi.ProgressLocation.Notification;
     export const choose = async () => {${quickPickPair}};`,
    `import * as editorApi from "vscode";
     export const location = editorApi.ProgressLocation.Window;
     export const choose = async () => {${quickPickPair}};`,
    `import * as editorApi from "vscode";
     export const location = editorApi.ProgressLocation.SourceControl;
     export const choose = async () => {${quickPickPair}};`,
    `import * as editorApi from "vscode";
     interface Options { item: editorApi.QuickPickItem }
     export const choose = async () => {${quickPickPair}};`,
    `import * as editorApi from "vscode";
     interface Options { input: typeof editorApi.window.showQuickPick }
     export const choose = async () => {${quickPickPair}};`,
  ])("preserves two selections sharing the genuine current input UI: %s", (code) => {
    const result = runRule(serverSequentialIndependentAwait, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    `import * as editorApi from "foreign-editor-api";
     export const choose = async () => {${quickPickPair}};`,
    `import * as editorApi from "vscode";
     export const choose = async (editorApi) => {${quickPickPair}};`,
    `import * as editorApi from "vscode";
     editorApi.window.showQuickPick = async () => "replacement";
     export const choose = async () => {${quickPickPair}};`,
    `import * as editorApi from "vscode";
     editorApi.window = replacement;
     export const choose = async () => {${quickPickPair}};`,
    `import * as editorApi from "vscode";
     const receiver = editorApi.window;
     receiver.showQuickPick = replacement;
     export const choose = async () => {${quickPickPair}};`,
    `import * as editorApi from "vscode";
     change(editorApi);
     export const choose = async () => {${quickPickPair}};`,
    `import * as editorApi from "vscode";
     const {window: receiver} = editorApi;
     receiver.showQuickPick = replacement;
     export const choose = async () => {${quickPickPair}};`,
    `import * as editorApi from "vscode";
     const invoke = editorApi.window.showQuickPick.bind(editorApi.window);
     export const choose = async () => {${quickPickPair}};`,
    `import * as editorApi from "vscode";
     export {editorApi};
     export const choose = async () => {${quickPickPair}};`,
    `import * as editorApi from "vscode";
     export {window} from "vscode";
     export const choose = async () => {${quickPickPair}};`,
    `import * as editorApi from "vscode";
     eval("changeSdk()");
     export const choose = async () => {${quickPickPair}};`,
    `import * as editorApi from "vscode";
     enum Altered {value = (editorApi.window.showQuickPick = replacement, 1)}
     export const choose = async () => {${quickPickPair}};`,
    `import * as editorApi from "vscode";
     const sibling = editorApi.window.showInformationMessage;
     sibling.showQuickPick = replacement;
     export const choose = async () => {${quickPickPair}};`,
    `import * as editorApi from "vscode";
     const location = editorApi.ProgressLocation;
     change(location);
     export const choose = async () => {${quickPickPair}};`,
    `import * as editorApi from "vscode";
     editorApi.ProgressLocation.Notification = replacement;
     export const choose = async () => {${quickPickPair}};`,
    `import * as editorApi from "vscode";
     editorApi.window[methodName] = replacement;
     export const choose = async () => {${quickPickPair}};`,
    `import * as editorApi from "vscode";
     change(editorApi[namespaceName]);
     export const choose = async () => {${quickPickPair}};`,
    `import * as editorApi from "vscode";
     import receiver = editorApi.window;
     receiver.showQuickPick = replacement;
     export const choose = async () => {${quickPickPair}};`,
    `import * as editorApi from "vscode";
     Object.assign(editorApi.window, {showQuickPick: replacement});
     export const choose = async () => {${quickPickPair}};`,
    `import * as editorApi from "vscode";
     import { window as otherWindow } from "vscode";
     otherWindow.showQuickPick = replacement;
     export const choose = async () => {${quickPickPair}};`,
    `import * as editorApi from "vscode";
     const otherApi = require("vscode");
     otherApi.window.showQuickPick = replacement;
     export const choose = async () => {${quickPickPair}};`,
    `import * as editorApi from "vscode";
     import otherApi = require("vscode");
     otherApi.window.showQuickPick = replacement;
     export const choose = async () => {${quickPickPair}};`,
    `import * as editorApi from "vscode";
     import { createRequire as createLoader } from "node:module";
     const load = createLoader(__filename);
     const otherApi = load("vscode");
     otherApi.window.showQuickPick = replacement;
     export const choose = async () => {${quickPickPair}};`,
    `import * as editorApi from "vscode";
     import * as nodeModule from "module";
     const load = nodeModule.createRequire(import.meta.url);
     const loadProvider = load;
     const provider = "vscode";
     const otherApi = loadProvider(provider);
     otherApi.window.showQuickPick = replacement;
     export const choose = async () => {${quickPickPair}};`,
    `import * as editorApi from "vscode";
     import nodeModule = require("node:module");
     nodeModule.createRequire(__filename)("vscode").window.showQuickPick = replacement;
     export const choose = async () => {${quickPickPair}};`,
    `import * as editorApi from "vscode";
     import nodeModule = require("node:module");
     const makeLoader = nodeModule.createRequire;
     const load = makeLoader(__filename);
     load("vscode").window.showQuickPick = replacement;
     export const choose = async () => {${quickPickPair}};`,
    `import * as editorApi from "vscode";
     import nodeModule = require("module");
     const { createRequire: makeLoader } = nodeModule;
     const load = makeLoader(__filename);
     load("vscode").window.showQuickPick = replacement;
     export const choose = async () => {${quickPickPair}};`,
    `import * as editorApi from "vscode";
     import { Module as NodeModule } from "node:module";
     NodeModule.createRequire(import.meta.url)("vscode").window.showQuickPick = replacement;
     export const choose = async () => {${quickPickPair}};`,
    `import * as editorApi from "vscode";
     import * as nodeModule from "node:module";
     nodeModule.Module.createRequire(import.meta.url)("vscode").window.showQuickPick = replacement;
     export const choose = async () => {${quickPickPair}};`,
    `import * as editorApi from "vscode";
     import { createRequire } from "node:module";
     createRequire(import.meta.url)("vs" + "code").window.showQuickPick = replacement;
     export const choose = async () => {${quickPickPair}};`,
    `import * as editorApi from "vscode";
     import nodeModule = require("node:module");
     const {Module: NodeModule} = nodeModule;
     const {createRequire: makeLoader} = NodeModule;
     makeLoader(__filename)("vscode").window.showQuickPick = replacement;
     export const choose = async () => {${quickPickPair}};`,
    `import * as editorApi from "vscode";
     const otherApi = await import("vscode");
     otherApi.window.showQuickPick = replacement;
     export const choose = async () => {${quickPickPair}};`,
    `import * as editorApi from "vscode";
     const alter = (value = editorApi.window.showQuickPick = replacement) => {};
     export const choose = async () => {${quickPickPair}};`,
    `import * as editorApi from "vscode";
     const alter = (value = editorApi.window.showQuickPick = replacement) => {
       var editorApi;
     };
     export const choose = async () => {${quickPickPair}};`,
    `import * as editorApi from "vscode";
     export const choose = async () => {${quickPickPair.replaceAll(".showQuickPick(", ".showInputBox(")}};`,
    `import * as editorApi from "vscode";
     export const choose = async () => {${quickPickPair.replace(".showQuickPick(", ".showInputBox(")}};`,
    `import { window as editorWindow } from "vscode";
     export const choose = async () => {${quickPickPair.replaceAll("editorApi.window", "editorWindow")}};`,
    `import * as editorApi from "vscode";
     export const choose = async () => {${quickPickPair.replaceAll(".showQuickPick(", ".showQuickPick?.(")}};`,
    `import * as editorApi from "vscode";
     export const choose = async () => {${quickPickPair.replaceAll(".window", '["window"]')}};`,
    `export const load = async () => {
       const first = await fetch("https://example.invalid/record-one");
       const second = await fetch("https://example.invalid/record-two");
       return [first, second];
     };`,
  ])("retains the existing diagnostic outside the provider contract: %s", (code) => {
    const result = runRule(serverSequentialIndependentAwait, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
