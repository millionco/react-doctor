import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const requireFromRepository = createRequire(path.join(repositoryRoot, "package.json"));
const nativeRules = JSON.parse(
  fs.readFileSync(path.join(repositoryRoot, "native", "oxlint", "upstream.json"), "utf8"),
).nativeRules;
const argumentsList = process.argv.slice(2);
const readOption = (name) => {
  const optionIndex = argumentsList.indexOf(name);
  if (optionIndex === -1) return null;
  const optionValue = argumentsList[optionIndex + 1];
  if (!optionValue || optionValue.startsWith("--")) throw new Error(`${name} requires a value`);
  return optionValue;
};
const bindingDirectory = readOption("--directory");
const corpusDirectory = readOption("--corpus");
const configuredBindingPath =
  readOption("--binding") ?? process.env.REACT_DOCTOR_NATIVE_OXLINT_BINDING_PATH;
const nativeBindingCandidates = bindingDirectory
  ? fs
      .readdirSync(path.resolve(bindingDirectory))
      .filter((fileName) => fileName.endsWith(".node"))
      .map((fileName) => path.join(path.resolve(bindingDirectory), fileName))
  : configuredBindingPath
    ? [configuredBindingPath]
    : [];
if (nativeBindingCandidates.length > 1) {
  throw new Error(`expected one native binding, received ${nativeBindingCandidates.length}`);
}
const nativeBindingPath = nativeBindingCandidates[0];
if (!nativeBindingPath)
  throw new Error("pass --binding, --directory, or set the native binding env");
if (!fs.existsSync(nativeBindingPath))
  throw new Error(`native binding not found: ${nativeBindingPath}`);

const oxlintMainPath = requireFromRepository.resolve("oxlint");
const oxlintBinaryPath = path.join(
  path.resolve(path.dirname(oxlintMainPath), ".."),
  "bin",
  "oxlint",
);
const pluginPath = requireFromRepository.resolve("oxlint-plugin-react-doctor");
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-native-parity-"));
const fixtureDirectory = path.join(temporaryDirectory, "production-fixtures");
const fixturePath = path.join(fixtureDirectory, "app", "error.tsx");
const globalErrorFixturePath = path.join(fixtureDirectory, "app", "global-error.tsx");
const ogImageFixturePath = path.join(fixtureDirectory, "app", "opengraph-image.tsx");
const routeHandlerFixturePath = path.join(fixtureDirectory, "app", "api", "route.ts");
const safeGlobalErrorFixturePath = path.join(fixtureDirectory, "app", "safe", "global-error.tsx");
const safePageFixturePath = path.join(fixtureDirectory, "app", "page.tsx");
const safeRouteHandlerFixturePath = path.join(fixtureDirectory, "app", "safe", "route.ts");
const nonProductionFixturePath = path.join(temporaryDirectory, "fixture.test.tsx");
const configuredFixturePath = path.join(temporaryDirectory, "configured.tsx");
const stockConfigPath = path.join(temporaryDirectory, "stock.json");
const nativeConfigPath = path.join(temporaryDirectory, "native.json");
const configuredStockConfigPath = path.join(temporaryDirectory, "configured-stock.json");
const configuredNativeConfigPath = path.join(temporaryDirectory, "configured-native.json");
const EXPECTED_DIAGNOSTIC_COUNTS = {
  "jsx-no-duplicate-props": 1,
  "nextjs-no-vercel-og-import": 1,
  "no-children-prop": 4,
  "no-danger": 4,
  "no-document-write": 8,
  "no-moment": 1,
  "no-namespace": 2,
  "no-react-children": 2,
  "preact-no-react-hooks-import": 2,
  "rn-bottom-sheet-prefer-native": 1,
  "rn-no-deprecated-modules": 1,
  "rn-no-legacy-expo-packages": 1,
  "rn-no-panresponder": 1,
  "rn-prefer-pressable": 1,
  "rn-prefer-reanimated": 2,
  "use-lazy-motion": 1,
  "html-has-lang": 1,
  "no-access-key": 1,
  "no-clone-element": 1,
  "no-is-mounted": 1,
  "no-render-return-value": 2,
  "no-will-update-set-state": 1,
  "self-closing-comp": 2,
  "no-distracting-elements": 1,
  "require-render-return": 2,
  "jsx-no-comment-textnodes": 1,
  "void-dom-elements-no-children": 4,
  "forward-ref-uses-ref": 5,
  "aria-props": 1,
  "aria-unsupported-elements": 2,
  "no-unescaped-entities": 1,
  scope: 1,
  "no-set-state": 2,
  "no-find-dom-node": 2,
  "react-in-jsx-scope": 0,
  "tabindex-no-positive": 7,
  "no-autoplay-without-muted": 1,
  "details-requires-summary": 1,
  "no-broken-image-source": 4,
  "html-no-nested-form": 1,
  "no-img-lazy-with-high-fetchpriority": 1,
  "no-srcset-without-sizes": 1,
  "no-aria-hidden-on-focusable": 5,
  "jsx-props-no-spread-multi": 3,
  "no-redundant-should-component-update": 3,
  "no-direct-mutation-state": 2,
  "no-string-refs": 2,
  "state-in-constructor": 1,
  "nextjs-inline-script-missing-id": 1,
  "no-aria-hidden-on-body": 2,
  "html-xml-lang-mismatch": 1,
  "no-server-side-image-map": 1,
  "no-mixed-srcset-descriptors": 1,
  "no-assertive-status": 3,
  "no-uninformative-aria-label": 3,
  "no-aria-invalid-without-description": 4,
  "no-invalid-progress-range": 6,
  "preact-prefer-ondblclick": 3,
  "rn-no-set-native-props": 5,
  "rn-no-single-element-style-array": 2,
  "no-generic-handler-names": 1,
  "tanstack-start-no-dynamic-server-fn-import": 2,
  "nextjs-no-google-analytics-script": 2,
  "nextjs-no-head-import": 1,
  "nextjs-error-boundary-missing-use-client": 1,
  "nextjs-global-error-missing-html-body": 1,
  "nextjs-no-edge-og-runtime": 1,
  "nextjs-no-default-export-in-route-handler": 1,
  "nextjs-image-missing-sizes": 1,
  "nextjs-no-font-link": 1,
  "nextjs-no-polyfill-script": 1,
  "prefer-truncate-shorthand": 3,
  "no-multiple-main-landmarks": 3,
  "iframe-title-unique": 2,
  "html-label-has-single-control": 2,
  "fieldset-requires-legend": 2,
  "no-skipped-heading-level": 2,
  "no-duplicate-static-id-reference": 2,
  "motion-create-in-render": 5,
  "motion-use-transform-range-length": 3,
  "motion-value-constructor-in-render": 4,
  "dialog-has-accessible-name": 2,
  "no-disabled-zoom": 3,
  "nextjs-no-script-in-head": 1,
  "rendering-animate-svg-wrapper": 2,
  "rn-bottom-sheet-no-ignored-scroll-prop": 4,
  "rn-platform-shaking-use-direct-import": 1,
  "ink-newline-inside-text": 0,
  "ink-suspense-requires-concurrent": 0,
  "no-cascading-set-state": 0,
  "rn-animate-layout-property": 0,
  "rn-prefer-content-inset-adjustment": 0,
};
const BENCHMARK_FILE_COUNT = 100;
const BENCHMARK_CALL_COUNT_PER_FILE = 500;
const BENCHMARK_FINDING_COUNT_PER_FILE = 500;
const BENCHMARK_SAMPLE_COUNT = 5;
const OXLINT_OUTPUT_MAX_BYTES = 256 * 1024 * 1024;
const DISABLED_RULE_CATEGORIES = {
  correctness: "off",
  nursery: "off",
  pedantic: "off",
  perf: "off",
  restriction: "off",
  style: "off",
  suspicious: "off",
};
const REACT_DOCTOR_SETTINGS = {
  "react-doctor": {
    portedRuleMode: "curated",
    framework: "unknown",
    rootDirectory: repositoryRoot,
    capabilities: ["react"],
  },
};
const CONFIGURED_REACT_DOCTOR_SETTINGS = {
  "react-doctor": {
    ...REACT_DOCTOR_SETTINGS["react-doctor"],
    noStringRefs: { noTemplateLiterals: true },
    stateInConstructor: { mode: "never" },
  },
};
const shouldBenchmark = argumentsList.includes("--benchmark");
const fixture = `
import moment from "moment";
import type { Moment } from "moment";
import { ImageResponse } from "@vercel/og";
import React, { Children, useEffect, useMemo, useState, Component, forwardRef as wrapRef } from "react";
import ReactDOM from "react-dom";
import type { useMemo as PreactTypeOnlyHook } from "react";
import RawBottomSheet from "react-native-raw-bottom-sheet";
import { BottomSheetScrollView as SheetScroll } from "@gorhom/bottom-sheet";
import * as GorhomBottomSheet from "@gorhom/bottom-sheet";
import { Audio } from "expo-av/build/Audio";
import {
  Animated,
  AsyncStorage,
  LayoutAnimation,
  PanResponder as PR,
  TouchableOpacity,
  type WebView,
} from "react-native";
import * as ReactNative from "react-native";
import { motion, motionValue as createMotionValue, useTransform as mapMotionValue, type MotionConfig } from "framer-motion";
import * as MotionRuntime from "motion/react";
import Head from "next/head";
document.write("a");
document.writeln("b");
document["write"]("c");
document[\`writeln\`]("d");
document?.write("e");
document!.write("f");
(document as Document)["write"]("g");
(document satisfies Document).writeln("h");
document[method]("safe");
stream.write("safe");
{ const document = { write() {} }; document.write("safe"); }
const duplicateProps = <Widget value="first" value="second" />;
const sharedSpreadProps = {};
const duplicateIdentifierSpread = <Widget {...sharedSpreadProps} {...sharedSpreadProps} {...sharedSpreadProps} />;
const nestedSpreadProps = { options: {} };
const duplicateMemberSpread = <Widget {...nestedSpreadProps.options} {...(nestedSpreadProps.options)} />;
const distinctMemberSpreads = <Widget {...nestedSpreadProps.options} {...nestedSpreadProps.other} />;
const wrappedComputedSpreads = <Widget {...nestedSpreadProps[("options" as string)]} {...nestedSpreadProps.options} />;
const duplicateOptionalSpread = <Widget {...nestedSpreadProps?.options} {...nestedSpreadProps?.options} />;
const MotionRenderFixture = () => {
  const FirstMotionElement = motion.create("div");
  const SecondMotionElement = MotionRuntime.motion.create("span");
  const firstMotionValue = createMotionValue(0);
  const secondMotionValue = MotionRuntime.motionValue(1);
  const stableMotionValue = useMemo(() => createMotionValue(2), []);
  const deferredMotionFactory = () => motion.create("button");
  return <FirstMotionElement onClick={deferredMotionFactory}>{firstMotionValue.get() + secondMotionValue.get() + stableMotionValue.get()}<SecondMotionElement /></FirstMotionElement>;
};
const mismatchedMotionTransform = mapMotionValue(progress, [0, 0.5, 1], [0, 1]);
const mismatchedNamespacedMotionTransform = MotionRuntime.useTransform(progress, [0, 1], [0]);
const aliasedMotionCreate = motion.create;
const aliasedMotionValue = createMotionValue;
const aliasedMotionTransform = MotionRuntime.useTransform;
const mismatchedAliasedMotionTransform = aliasedMotionTransform(progress, [0, 1, 2], [0, 1]);
const MemoMotionFixture = React.memo(() => {
  const MissingDepsMotionElement = useMemo(() => aliasedMotionCreate("section"));
  const mappedMotionElements = ["article"].map((tagName) => aliasedMotionCreate(tagName));
  const mappedMotionValues = [0].map((value) => aliasedMotionValue(value));
  const immediateMotionValue = (() => (createMotionValue as typeof createMotionValue)(4))();
  const [StableMotionElement] = useState(() => motion.create("aside"));
  const stableMemoMotionValue = useMemo(() => createMotionValue(5), []);
  return <MissingDepsMotionElement>{mappedMotionElements.length + mappedMotionValues.length + immediateMotionValue.get() + stableMemoMotionValue.get()}<StableMotionElement /></MissingDepsMotionElement>;
});
const mapArray = Array.from;
const ArrayFromMotionFixture = () => mapArray(["nav"], (tagName) => motion.create(tagName));
const dynamicMotionTransform = mapMotionValue(progress, inputRange, outputRange);
const animatedSvg = <svg animate={{ opacity: 1 }} />;
const SvgElement = "svg" as const;
const animatedSvgAlias = <SvgElement whileInView={{ opacity: 1 }} />;
const staticSvg = <svg viewBox="0 0 24 24" />;
const ignoredBottomSheetScrollProperties = <SheetScroll scrollEventThrottle={16} decelerationRate="fast" onScrollBeginDrag={handleDrag} />;
const ignoredNamespacedBottomSheetScrollProperty = <GorhomBottomSheet.BottomSheetScrollView decelerationRate="normal" />;
const supportedBottomSheetScrollProperty = <SheetScroll onScroll={handleScroll} {...scrollProperties} />;
const currentPlatform = ReactNative.Platform.OS;
const namespaced = <svg:path />;
React.createElement("svg:path");
const danger = <div dangerouslySetInnerHTML={{ __html: markup }} />;
React.createElement("div", { dangerouslySetInnerHTML: { __html: markup } });
const suppressedOnlyForReact =
  // eslint-disable-next-line react/no-danger
  <div dangerouslySetInnerHTML={{ __html: markup }} />;
const suppressedReactDoctor =
  // eslint-disable-next-line react-doctor/no-danger
  <div dangerouslySetInnerHTML={{ __html: markup }} />;
const childrenProp = <Widget children="hidden" />;
React.createElement(Widget, { children: "hidden" });
Children.map(children, child => child);
React.Children.only(children);
const forwardedWithoutRef = React.forwardRef((props) => <div>{props.label}</div>);
const wrappedWithoutRef = wrapRef((props) => <div>{props.label}</div>);
const immutableForwardRef = wrapRef;
const aliasedWithoutRef = immutableForwardRef((props) => <div>{props.label}</div>);
const { forwardRef: destructuredForwardRef } = React;
const destructuredWithoutRef = destructuredForwardRef((props) => <div>{props.label}</div>);
const computedWithoutRef = React["forwardRef"]((props) => <div>{props.label}</div>);
const unrelatedForwardRef = (callback) => callback;
unrelatedForwardRef((props) => <div>{props.label}</div>);
const page = <html></html>;
const untitledFrame = <iframe />;
const invalidFrameTitle = <iframe title={undefined} />;
const invalidAnchor = <a>Open</a>;
const missingWidget = <MissingWidget />;
const missingMemberWidget = <Missing.Namespace />;
const mouseOnly = <div onMouseOver={handle} />;
const distracting = <marquee>scroll</marquee>;
const redundantRole = <button role="button">Save</button>;
const unsupportedAria = <button aria-invalid="true">Save</button>;
const invalidAria = <button aria-labeledby="label">Save</button>;
const reservedAria = <meta aria-label="description" role="none" />;
const unescapedEntity = <div>it's visible</div>;
const invalidScope = <td scope="col" />;
const voidChildren = <img children="description" />;
const visibleComment = <div>// visible comment</div>;
const literalComment = <code>// deliberately rendered</code>;
const styledComment = <span className="comment">// deliberately rendered</span>;
const separator = <div>{used} // 512 GB</div>;
const commentOnlyVoid = <input>{/* hint */}</input>;
const nullishVoid = <br>{undefined}{null}{void 0}</br>;
const formattingOnlyVoid = <img>
</img>;
const VoidTag = "img" as const;
const constantVoidChildren = <VoidTag>description</VoidTag>;
React.createElement("br", {}, null, undefined, void 0);
React.createElement("br", {}, "description");
React.createElement("br", { [children]: "description" });
React.createElement("div", { [dangerouslySetInnerHTML]: { __html: markup } });
window.document.createElement("img", { children: "description", dangerouslySetInnerHTML: { __html: markup } }, "description");
namespace[document].createElement("img", {}, "description");
const shortcut = <button accessKey="s">Save</button>;
const positiveTabOrder = <button tabIndex={2}>Later</button>;
const hexadecimalPositiveTabOrder = <button tabIndex="0x2">Later</button>;
const paddedPositiveTabOrder = <button tabIndex=" 2 ">Later</button>;
const infiniteTabOrder = <button tabIndex="Infinity">Normal</button>;
const staticFalseTabOrder = <button tabIndex={false ? 2 : 0}>Normal</button>;
const numericFalseTabOrder = <button tabIndex={0 ? 2 : 0}>Normal</button>;
const unaryPositiveTabOrder = <button tabIndex={+2}>Normal</button>;
const literalConditionalTabOrder = <button tabIndex={true ? 3 : -1}>Later</button>;
const unknownConditionalTabOrder = <button tabIndex={condition ? 4 : -1}>Later</button>;
const alternateConditionalTabOrder = <button tabIndex={false ? -1 : 5}>Later</button>;
const staticTemplateTabOrder = <button tabIndex={\`6\`}>Later</button>;
const dynamicTemplateTabOrder = <button tabIndex={\`7\${suffix}\`}>Normal</button>;
const hiddenFocusableButton = <button aria-hidden={true}>Hidden</button>;
const hiddenFocusableInput = <input aria-hidden="true" />;
const hiddenFocusablePlayer = <video controls aria-hidden src="clip.mp4" />;
const hiddenFocusableDiv = <div tabIndex={0} aria-hidden={"true"}>Hidden</div>;
const dynamicAriaHidden = <button aria-hidden={isHidden}>Dynamic</button>;
const visuallyHiddenInput = <input className="hidden" aria-hidden />;
const negativeHiddenButton = <button tabIndex={-1} aria-hidden />;
const FocusableAlias = "button" as const;
const hiddenFocusableAlias = <FocusableAlias aria-hidden />;
const legacyStringRef = <Widget ref="legacy" />;
const inlineNextScript = <Script>window.analytics = true;</Script>;
const identifiedInlineNextScript = <Script id="analytics">window.analytics = true;</Script>;
const externalNextScript = <Script src="/analytics.js" />;
const spreadInlineNextScript = <Script {...scriptProperties}>window.analytics = true;</Script>;
const inaccessibleBody = <body aria-hidden="true" />;
const spreadOverridesHiddenBody = <body aria-hidden {...{ "aria-hidden": false }} />;
const hiddenBodyOverridesSpread = <body {...{ "aria-hidden": false }} aria-hidden />;
const dynamicSpreadHiddenBody = <body aria-hidden {...bodyProperties} />;
const conflictingDocumentLanguage = <html lang="en-US" xml:lang="fr-CA" />;
const matchingDocumentLanguage = <html lang="EN-us" xml:lang="en-GB" />;
const spreadOverridesDocumentLanguage = <html lang="en" xml:lang="fr" {...{ "xml:lang": "en" }} />;
const serverSideImageMap = <img src="map.png" alt="Campus" isMap />;
const disabledServerSideImageMap = <img src="map.png" alt="Campus" isMap={false} />;
const dynamicServerSideImageMap = <img src="map.png" alt="Campus" isMap={isEnabled} />;
const spreadOverridesServerSideImageMap = <img src="map.png" alt="Campus" isMap {...{ isMap: false }} />;
const mixedSourceSet = <img src="fallback.jpg" srcSet="small.jpg 640w, large.jpg 2x" sizes="100vw" />;
const consistentSourceSet = <img src="fallback.jpg" srcSet="small.jpg 640w, large.jpg 1280w" sizes="100vw" />;
const spreadOwnedMixedSourceSet = <img srcSet="small.jpg 640w, large.jpg 2x" {...imageProperties} />;
const assertiveStatus = <div role="status" aria-live="assertive">Saved</div>;
const politeStatus = <div role="status" aria-live="polite">Saved</div>;
const customAssertiveStatus = <Status role="status" aria-live="assertive">Saved</Status>;
const IntrinsicStatusTag = "div" as const;
const intrinsicAliasAssertiveStatus = <IntrinsicStatusTag role="status" aria-live="assertive">Saved</IntrinsicStatusTag>;
const AliasedStatusTag = IntrinsicStatusTag;
const aliasedAssertiveStatus = <AliasedStatusTag role="status" aria-live="assertive">Saved</AliasedStatusTag>;
const ConditionalStatusTag = isOutput ? "output" : "div";
const conditionalAssertiveStatus = <ConditionalStatusTag role="status" aria-live="assertive">Saved</ConditionalStatusTag>;
const spreadAssertiveStatus = <div role="status" aria-live="assertive" {...statusProperties}>Saved</div>;
const uninformativeButtonLabel = <button aria-label=" Button " />;
const uninformativeImageLabel = <svg aria-label={"image"} />;
const spreadUninformativeLabel = <button aria-label="icon" {...labelProperties} />;
const descriptiveButtonLabel = <button aria-label="Search" />;
const dynamicButtonLabel = <button aria-label={buttonLabel} />;
const invalidInput = <input aria-invalid />;
const invalidSelect = <select aria-invalid="true" />;
const invalidTextarea = <textarea aria-invalid={true} />;
const grammarInvalidInput = <input aria-invalid="grammar" />;
const describedInvalidInput = <input aria-invalid aria-describedby="email-error" />;
const dynamicInvalidInput = <input aria-invalid={isInvalid} />;
const spreadInvalidInput = <input aria-invalid {...inputProperties} />;
const invalidNativeProgressAboveMaximum = <progress value={11} max={10} />;
const invalidNativeProgressBelowMinimum = <progress value={-1} max={10} />;
const invalidWrappedNativeProgress = <progress value={(-1 as number)} max={(10 as number)} />;
const invalidNativeProgressMaximum = <progress value={1} max={0} />;
const invalidAriaProgressRange = <div role="progressbar" aria-valuemin={10} aria-valuemax={5} aria-valuenow={7} />;
const invalidAriaProgressCurrent = <div role="progressbar" aria-valuemin={0} aria-valuemax={10} aria-valuenow={12} />;
const validNativeProgress = <progress value={5} max={10} />;
const dynamicNativeProgress = <progress value={progressValue} max={progressMaximum} />;
const spreadAriaProgress = <div role="progressbar" aria-valuenow={progressValue} {...progressProperties} />;
const preactDoubleClickListItem = <li onDoubleClick={openInline}>Item</li>;
const preactDoubleClickButton = <button onDoubleClick={beginEdit}>Edit</button>;
const preactDblClickButton = <button onDblClick={beginEdit}>Edit</button>;
const PreactItem = () => null;
const preactCustomDoubleClick = <PreactItem onDoubleClick={openInline}>Item</PreactItem>;
const PreactButton = "button" as const;
const preactAliasedDoubleClick = <PreactButton onDoubleClick={openInline}>Open</PreactButton>;
inputRef.current.setNativeProps({ text: value });
textInputRef.current?.setNativeProps({ selection: { start, end } });
this.rootViewRef.current.setNativeProps({ style: { opacity: 0 } });
inputRef.current?.textInputRef.current?.setNativeProps({ selection });
(inputRef.current as any).setNativeProps({ text: value });
config.setNativeProps({ text: value });
inputRef.current.focus();
const singleStyleArray = <View style={[styles.box]} />;
const singleCustomStyleArray = <View contentStyle={[styles.content]} />;
const spreadStyleArray = <View style={[...baseStyles]} />;
const multipleStyleArray = <View style={[styles.box, isActive && styles.active]} />;
const genericClickHandler = <button onClick={handleClick}>Save</button>;
const actionClickHandler = <button onClick={saveProfile}>Save</button>;
const dynamicServerFunctions = import("~/utils/users.functions");
const typedDynamicServerFunctions = import(\`~/utils/admin.functions.ts\`);
const dynamicClientModule = import("~/components/chart");
const dynamicServerFunctionName = import(\`~/utils/\${serverFunctionName}.functions\`);
const tagManagerScript = <Script src="https://www.googletagmanager.com/gtag/js?id=G-XYZ" />;
const analyticsScript = <script src="https://www.google-analytics.com/analytics.js" />;
const unrelatedScript = <Script src="https://example.com/widget.js" />;
const expressionAnalyticsScript = <Script src={"https://www.google-analytics.com/analytics.js"} />;
const truncateClasses = <span className="overflow-hidden text-ellipsis whitespace-nowrap" />;
const reorderedTruncateClasses = <span className={"whitespace-nowrap text-sm overflow-hidden text-ellipsis"} />;
const templateTruncateClasses = <span className={\`text-ellipsis overflow-hidden whitespace-nowrap\`} />;
const incompleteTruncateClasses = <span className="overflow-hidden whitespace-nowrap" />;
const duplicateMainLandmarks = <><main /><section><main /></section><main /></>;
const MainLandmark = "main" as const;
const duplicateAliasedMainLandmarks = <section><MainLandmark /><MainLandmark /></section>;
const separateMainLandmarks = condition ? <main /> : <main />;
const duplicateFrameTitles = <><iframe title="Store map" /><section><frame title={" store   MAP "} /></section></>;
const duplicateUnicodeFrameTitles = <><iframe title={"\uFEFFAdmin\u00A0map"} /><iframe title=" admin map " /></>;
const distinctFrameTitles = <><iframe title="Store map" /><iframe title="Campus map" /></>;
const dynamicFrameTitles = <><iframe title={frameTitle} /><iframe title={frameTitle} /></>;
const expressionBranchFrameTitles = <div>{condition && <><iframe title="Map" /><iframe title="Map" /></>}</div>;
const multiControlLabel = <label>Name <input /><span><select /></span></label>;
const LabelTag = "label" as const;
const InputTag = "input" as const;
const aliasedMultiControlLabel = <LabelTag><InputTag /><textarea /></LabelTag>;
const expressionControlLabel = <label><input />{condition && <input />}</label>;
const unnamedFieldset = <fieldset><input /><select /></fieldset>;
const nestedLegendFieldset = <fieldset><div><legend>Contact</legend></div><input /><textarea /></fieldset>;
const namedFieldset = <fieldset><legend>Contact</legend><input /><input /></fieldset>;
const spreadFieldset = <fieldset {...fieldsetProperties}><input /><input /></fieldset>;
const skippedMainHeading = <main><h1>Title</h1><section><h3>Details</h3></section></main>;
const nestedSkippedArticleHeading = <main><h1>Title</h1><article><h2>Article</h2><h4>Detail</h4></article></main>;
const expressionHeading = <main><h1>Title</h1>{condition && <h3>Details</h3>}</main>;
const continuousHeadings = <article><h1>Title</h1><h2>Details</h2></article>;
const duplicateEmailId = <><label htmlFor="email">Email</label><input id="email" /><input id="email" /></>;
const duplicateUnicodeId = <><div aria-labelledby="item" /><span id={"\uFEFFitem\u00A0"} /><span id="item" /></>;
const conditionalDuplicateId = <div aria-labelledby="item">{condition ? <span id="item" /> : <span id="item" />}</div>;
const customDuplicateIdReference = <><Custom aria-labelledby="item" /><span id="item" /><span id="item" /></>;
const unnamedDialog = <dialog>Confirm</dialog>;
const unnamedRoleDialog = <section role="alertdialog">Confirm</section>;
const namedDialog = <div role="dialog" aria-labelledby="dialog-title">Confirm</div>;
const spreadDialog = <dialog {...dialogProperties}>Confirm</dialog>;
const disabledViewportZoom = <meta name="viewport" content="width=device-width, user-scalable=yes, user-scalable=no, maximum-scale=1" />;
const userScalableViewportZoom = <meta name="viewport" content="width=device-width, user-scalable=yes, user-scalable=no" />;
const restrictiveViewportZoom = <meta name="viewport" content="width=device-width, maximum-scale=1.5.9" />;
const accessibleViewportZoom = <meta name="viewport" content="width=device-width, maximum-scale=5" />;
const ignoredHeadScript = <Head><Script src="/ignored.js" /></Head>;
const headAttributeScript = <Head icon={<Script src="/loaded.js" />} />;
const autoplayingVideo = <video autoPlay src="hero.mp4" />;
const mutedAutoplayingVideo = <video autoPlay muted src="hero.mp4" />;
const unnamedDetails = <details><p>Answer</p></details>;
const brokenImage = <img alt="Preview" />;
const nestedForm = <form><form /></form>;
const conflictingImagePriority = <img src="hero.png" loading="lazy" fetchPriority="high" />;
const responsiveImage = <img srcSet="hero-640.jpg 640w, hero-1280.jpg 1280w" alt="" />;
const fillImageWithoutSizes = <Image fill src="hero.jpg" alt="Hero" />;
const forwardedImageSizes = <Image fill {...imageProperties} />;
const disabledFillImage = <Image fill={false} src="hero.jpg" alt="Hero" />;
const googleFontStylesheet = <link rel="stylesheet" href="https://fonts.googleapis.com/css?family=Inter" />;
const googleFontPreconnect = <link rel="preconnect" href="https://fonts.googleapis.com" />;
const polyfillScript = <script src="https://polyfill.io/v3/polyfill.min.js" />;
const dataPolyfillScript = <script src="data:text/javascript,polyfill.min.js" />;
const clonedChild = React.cloneElement(child);
const renderResult = ReactDOM.render(<div />, root);
const wrappedRenderResult = (ReactDOM as any).render(<div />, root);
ReactDOM.findDOMNode(root);
ReactDOM[findDOMNode](root);
(ReactDOM as any).findDOMNode(root);
ReactDOM[(findDOMNode as any)](root);
class LegacyState extends Component {
  state = { value: 0, count: 0 };
  componentWillUpdate() { this.setState({ loading: true }); }
  computedUpdate() { this[setState]({ loading: false }); this[(setState as any)]({}); }
  update() { this.state.value = 1; this.state.count++; this.refs.legacy; this.isMounted(); }
  render() { return null; }
}
class PureOverride extends React.PureComponent {
  shouldComponentUpdate() { return true; }
}
const AnonymousPureOverride = class extends PureComponent {
  "shouldComponentUpdate" = () => true;
};
class ComputedPureOverride extends React[PureComponent] {
  [shouldComponentUpdate]() { return true; }
}
class WrappedReactPure extends (React as any).PureComponent {
  shouldComponentUpdate() { return true; }
}
class ConnectionPool {
  isMounted() { return true; }
  inspect() { return this.isMounted(); }
}
class MissingRender extends Component {
  render() {}
}
class ForeignSuppressedMissingRender extends Component {
  // eslint-disable-next-line react/require-render-return
  render() {}
}
`;

const normalizeDiagnostics = (diagnostics) =>
  diagnostics
    .filter(
      (diagnostic) =>
        typeof diagnostic.code === "string" &&
        nativeRules.some((nativeRuleId) => diagnostic.code.includes(`(${nativeRuleId})`)),
    )
    .map((diagnostic) => ({
      code: diagnostic.code.replace("react-doctor-native", "react-doctor"),
      filename: path.relative(repositoryRoot, path.resolve(repositoryRoot, diagnostic.filename)),
      message: diagnostic.message,
      severity: diagnostic.severity,
      labels: diagnostic.labels,
    }))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));

const countDiagnosticsByRule = (diagnostics) => {
  const counts = Object.fromEntries(nativeRules.map((nativeRuleId) => [nativeRuleId, 0]));
  for (const diagnostic of diagnostics) {
    const ruleId = nativeRules.find((candidateRuleId) =>
      diagnostic.code.includes(`(${candidateRuleId})`),
    );
    if (ruleId) counts[ruleId] += 1;
  }
  return counts;
};

const runOxlint = (configPath, environment, targetPath = fixturePath) => {
  const startedAt = performance.now();
  const result = spawnSync(
    process.execPath,
    [oxlintBinaryPath, "-c", configPath, "--format", "json", targetPath],
    {
      cwd: repositoryRoot,
      env: environment,
      encoding: "utf8",
      maxBuffer: OXLINT_OUTPUT_MAX_BYTES,
    },
  );
  if (result.error) throw result.error;
  if (!result.stdout) {
    throw new Error(result.stderr || `oxlint exited with status ${result.status}`);
  }
  const parsed = JSON.parse(result.stdout);
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(result.stderr || `oxlint exited with status ${result.status}`);
  }
  return {
    durationMs: performance.now() - startedAt,
    diagnostics: normalizeDiagnostics(parsed.diagnostics),
  };
};

const buildConfig = ({ isNative, settings, ruleIds = nativeRules }) => ({
  categories: DISABLED_RULE_CATEGORIES,
  plugins: isNative ? ["react-doctor-native"] : [],
  jsPlugins: isNative ? [] : [pluginPath],
  settings,
  rules: Object.fromEntries(
    ruleIds.map((nativeRuleId) => [
      `${isNative ? "react-doctor-native" : "react-doctor"}/${nativeRuleId}`,
      "warn",
    ]),
  ),
});

try {
  fs.mkdirSync(path.dirname(fixturePath), { recursive: true });
  fs.writeFileSync(fixturePath, fixture);
  fs.writeFileSync(
    globalErrorFixturePath,
    `'use client';\nimport React from "react";\nexport default function GlobalError() { return <div />; }\n`,
  );
  fs.writeFileSync(ogImageFixturePath, 'export const runtime = "edge";');
  fs.mkdirSync(path.dirname(routeHandlerFixturePath), { recursive: true });
  fs.writeFileSync(routeHandlerFixturePath, "export default function handler() {}\n");
  fs.mkdirSync(path.dirname(safeGlobalErrorFixturePath), { recursive: true });
  fs.writeFileSync(
    safeGlobalErrorFixturePath,
    `'use client';\nimport React from "react";\nexport default function GlobalError() { return <html lang="en"><body /></html>; }\n`,
  );
  fs.writeFileSync(safePageFixturePath, 'export const runtime = "edge";\n');
  fs.mkdirSync(path.dirname(safeRouteHandlerFixturePath), { recursive: true });
  fs.writeFileSync(
    safeRouteHandlerFixturePath,
    "export const GET = () => new Response();\nexport default function handler() {}\n",
  );
  fs.writeFileSync(
    nonProductionFixturePath,
    `const shortcut = <button accessKey="s" />; const classicJsx = <div />; const inlineNextScript = <Script>window.analytics = true;</Script>;`,
  );
  fs.writeFileSync(
    configuredFixturePath,
    `
import React, { Component } from "react";
class ConfiguredState extends Component {
  state = {};
  constructor() {
    super();
    this.state = {};
    this["state"] = {};
    this[state] = {};
  }
  render() { return <Widget ref={\`legacy-\${id}\`} />; }
}
`,
  );
  fs.writeFileSync(
    stockConfigPath,
    JSON.stringify(buildConfig({ isNative: false, settings: REACT_DOCTOR_SETTINGS })),
  );
  fs.writeFileSync(
    nativeConfigPath,
    JSON.stringify(buildConfig({ isNative: true, settings: REACT_DOCTOR_SETTINGS })),
  );
  const configuredRuleIds = ["no-string-refs", "state-in-constructor"];
  fs.writeFileSync(
    configuredStockConfigPath,
    JSON.stringify(
      buildConfig({
        isNative: false,
        settings: CONFIGURED_REACT_DOCTOR_SETTINGS,
        ruleIds: configuredRuleIds,
      }),
    ),
  );
  fs.writeFileSync(
    configuredNativeConfigPath,
    JSON.stringify(
      buildConfig({
        isNative: true,
        settings: CONFIGURED_REACT_DOCTOR_SETTINGS,
        ruleIds: configuredRuleIds,
      }),
    ),
  );
  const stockDiagnostics = runOxlint(stockConfigPath, process.env, fixtureDirectory).diagnostics;
  const nativeEnvironment = {
    ...process.env,
    NAPI_RS_NATIVE_LIBRARY_PATH: path.resolve(nativeBindingPath),
  };
  const nativeDiagnostics = runOxlint(
    nativeConfigPath,
    nativeEnvironment,
    fixtureDirectory,
  ).diagnostics;
  const stockDiagnosticCounts = countDiagnosticsByRule(stockDiagnostics);
  if (JSON.stringify(stockDiagnosticCounts) !== JSON.stringify(EXPECTED_DIAGNOSTIC_COUNTS)) {
    throw new Error(
      `unexpected JavaScript diagnostic coverage\nexpected=${JSON.stringify(EXPECTED_DIAGNOSTIC_COUNTS, null, 2)}\nreceived=${JSON.stringify(stockDiagnosticCounts, null, 2)}`,
    );
  }
  if (JSON.stringify(nativeDiagnostics) !== JSON.stringify(stockDiagnostics)) {
    const nativeDiagnosticKeys = new Set(nativeDiagnostics.map(JSON.stringify));
    const stockDiagnosticKeys = new Set(stockDiagnostics.map(JSON.stringify));
    const stockOnlyDiagnostic = stockDiagnostics.find(
      (diagnostic) => !nativeDiagnosticKeys.has(JSON.stringify(diagnostic)),
    );
    const nativeOnlyDiagnostic = nativeDiagnostics.find(
      (diagnostic) => !stockDiagnosticKeys.has(JSON.stringify(diagnostic)),
    );
    throw new Error(
      `native parity failed\nstock count=${stockDiagnostics.length}\nnative count=${nativeDiagnostics.length}\nstock only=${JSON.stringify(stockOnlyDiagnostic, null, 2)}\nnative only=${JSON.stringify(nativeOnlyDiagnostic, null, 2)}`,
    );
  }
  process.stdout.write(`Native parity passed for ${stockDiagnostics.length} diagnostics.\n`);

  const stockNonProductionDiagnostics = runOxlint(
    stockConfigPath,
    process.env,
    nonProductionFixturePath,
  ).diagnostics;
  const nativeNonProductionDiagnostics = runOxlint(
    nativeConfigPath,
    nativeEnvironment,
    nonProductionFixturePath,
  ).diagnostics;
  const expectedNonProductionDiagnosticCounts = {
    ...Object.fromEntries(nativeRules.map((nativeRuleId) => [nativeRuleId, 0])),
    "react-in-jsx-scope": 3,
  };
  if (
    JSON.stringify(countDiagnosticsByRule(stockNonProductionDiagnostics)) !==
      JSON.stringify(expectedNonProductionDiagnosticCounts) ||
    JSON.stringify(nativeNonProductionDiagnostics) !== JSON.stringify(stockNonProductionDiagnostics)
  ) {
    throw new Error(
      `native non-production parity failed\nstock=${JSON.stringify(stockNonProductionDiagnostics, null, 2)}\nnative=${JSON.stringify(nativeNonProductionDiagnostics, null, 2)}`,
    );
  }

  const configuredStockDiagnostics = runOxlint(
    configuredStockConfigPath,
    process.env,
    configuredFixturePath,
  ).diagnostics;
  const configuredNativeDiagnostics = runOxlint(
    configuredNativeConfigPath,
    nativeEnvironment,
    configuredFixturePath,
  ).diagnostics;
  const expectedConfiguredDiagnosticCounts = {
    ...Object.fromEntries(nativeRules.map((nativeRuleId) => [nativeRuleId, 0])),
    "no-string-refs": 1,
    "state-in-constructor": 3,
  };
  if (
    JSON.stringify(countDiagnosticsByRule(configuredStockDiagnostics)) !==
      JSON.stringify(expectedConfiguredDiagnosticCounts) ||
    JSON.stringify(configuredNativeDiagnostics) !== JSON.stringify(configuredStockDiagnostics)
  ) {
    throw new Error(
      `native configured parity failed\nstock=${JSON.stringify(configuredStockDiagnostics, null, 2)}\nnative=${JSON.stringify(configuredNativeDiagnostics, null, 2)}`,
    );
  }

  if (corpusDirectory) {
    const resolvedCorpusDirectory = path.resolve(corpusDirectory);
    const corpusRepositories = fs
      .readdirSync(resolvedCorpusDirectory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .map((entry) => entry.name)
      .sort();
    if (corpusRepositories.length === 0) {
      throw new Error(`no repositories found in corpus: ${resolvedCorpusDirectory}`);
    }
    let corpusDiagnosticCount = 0;
    for (const repositoryName of corpusRepositories) {
      const repositoryPath = path.join(resolvedCorpusDirectory, repositoryName);
      const repositoryStockDiagnostics = runOxlint(
        stockConfigPath,
        process.env,
        repositoryPath,
      ).diagnostics;
      const repositoryNativeDiagnostics = runOxlint(
        nativeConfigPath,
        nativeEnvironment,
        repositoryPath,
      ).diagnostics;
      if (
        JSON.stringify(repositoryNativeDiagnostics) !== JSON.stringify(repositoryStockDiagnostics)
      ) {
        const nativeDiagnosticKeys = new Set(repositoryNativeDiagnostics.map(JSON.stringify));
        const stockDiagnosticKeys = new Set(repositoryStockDiagnostics.map(JSON.stringify));
        const stockOnlyDiagnostic = repositoryStockDiagnostics.find(
          (diagnostic) => !nativeDiagnosticKeys.has(JSON.stringify(diagnostic)),
        );
        const nativeOnlyDiagnostic = repositoryNativeDiagnostics.find(
          (diagnostic) => !stockDiagnosticKeys.has(JSON.stringify(diagnostic)),
        );
        throw new Error(
          `native corpus parity failed for ${repositoryName}\nstock count=${repositoryStockDiagnostics.length}\nnative count=${repositoryNativeDiagnostics.length}\nstock only=${JSON.stringify(stockOnlyDiagnostic, null, 2)}\nnative only=${JSON.stringify(nativeOnlyDiagnostic, null, 2)}`,
        );
      }
      corpusDiagnosticCount += repositoryStockDiagnostics.length;
    }
    process.stdout.write(
      `Native corpus parity passed for ${corpusRepositories.length} repositories and ${corpusDiagnosticCount} diagnostics.\n`,
    );
  }

  if (shouldBenchmark) {
    const benchmarkDirectory = path.join(temporaryDirectory, "benchmark");
    fs.mkdirSync(benchmarkDirectory);
    const benchmarkSource = `${Array.from(
      { length: BENCHMARK_CALL_COUNT_PER_FILE },
      (_unused, index) => `stream.write(value${index});`,
    ).join("\n")}\n`;
    for (let fileIndex = 0; fileIndex < BENCHMARK_FILE_COUNT; fileIndex += 1) {
      fs.writeFileSync(path.join(benchmarkDirectory, `fixture-${fileIndex}.ts`), benchmarkSource);
    }
    runOxlint(stockConfigPath, process.env, benchmarkDirectory);
    runOxlint(nativeConfigPath, nativeEnvironment, benchmarkDirectory);
    const stockDurationsMs = [];
    const nativeDurationsMs = [];
    for (let sampleIndex = 0; sampleIndex < BENCHMARK_SAMPLE_COUNT; sampleIndex += 1) {
      const shouldRunNativeFirst = sampleIndex % 2 === 1;
      if (shouldRunNativeFirst) {
        nativeDurationsMs.push(
          runOxlint(nativeConfigPath, nativeEnvironment, benchmarkDirectory).durationMs,
        );
        stockDurationsMs.push(
          runOxlint(stockConfigPath, process.env, benchmarkDirectory).durationMs,
        );
      } else {
        stockDurationsMs.push(
          runOxlint(stockConfigPath, process.env, benchmarkDirectory).durationMs,
        );
        nativeDurationsMs.push(
          runOxlint(nativeConfigPath, nativeEnvironment, benchmarkDirectory).durationMs,
        );
      }
    }
    const median = (values) => {
      const sortedValues = [...values].sort((left, right) => left - right);
      return sortedValues[Math.floor(sortedValues.length / 2)];
    };
    const stockMedianMs = median(stockDurationsMs);
    const nativeMedianMs = median(nativeDurationsMs);
    const speedupPercent = ((stockMedianMs - nativeMedianMs) / stockMedianMs) * 100;
    process.stdout.write(
      `Benchmark p50: JavaScript ${stockMedianMs.toFixed(1)} ms, native ${nativeMedianMs.toFixed(1)} ms, ${speedupPercent.toFixed(1)}% faster.\n`,
    );

    const findingBenchmarkDirectory = path.join(temporaryDirectory, "finding-benchmark");
    fs.mkdirSync(findingBenchmarkDirectory);
    const findingBenchmarkSource = `${Array.from(
      { length: BENCHMARK_FINDING_COUNT_PER_FILE },
      (_unused, index) => `const Empty${index} = <Widget></Widget>;`,
    ).join("\n")}\n`;
    for (let fileIndex = 0; fileIndex < BENCHMARK_FILE_COUNT; fileIndex += 1) {
      fs.writeFileSync(
        path.join(findingBenchmarkDirectory, `fixture-${fileIndex}.tsx`),
        findingBenchmarkSource,
      );
    }
    runOxlint(stockConfigPath, process.env, findingBenchmarkDirectory);
    runOxlint(nativeConfigPath, nativeEnvironment, findingBenchmarkDirectory);
    const stockFindingDurationsMs = [];
    const nativeFindingDurationsMs = [];
    for (let sampleIndex = 0; sampleIndex < BENCHMARK_SAMPLE_COUNT; sampleIndex += 1) {
      const shouldRunNativeFirst = sampleIndex % 2 === 1;
      if (shouldRunNativeFirst) {
        nativeFindingDurationsMs.push(
          runOxlint(nativeConfigPath, nativeEnvironment, findingBenchmarkDirectory).durationMs,
        );
        stockFindingDurationsMs.push(
          runOxlint(stockConfigPath, process.env, findingBenchmarkDirectory).durationMs,
        );
      } else {
        stockFindingDurationsMs.push(
          runOxlint(stockConfigPath, process.env, findingBenchmarkDirectory).durationMs,
        );
        nativeFindingDurationsMs.push(
          runOxlint(nativeConfigPath, nativeEnvironment, findingBenchmarkDirectory).durationMs,
        );
      }
    }
    const stockFindingMedianMs = median(stockFindingDurationsMs);
    const nativeFindingMedianMs = median(nativeFindingDurationsMs);
    const findingSpeedupPercent =
      ((stockFindingMedianMs - nativeFindingMedianMs) / stockFindingMedianMs) * 100;
    process.stdout.write(
      `Finding benchmark p50: JavaScript ${stockFindingMedianMs.toFixed(1)} ms, native ${nativeFindingMedianMs.toFixed(1)} ms, ${findingSpeedupPercent.toFixed(1)}% faster.\n`,
    );
  }
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}
