// GENERATED FILE — do not edit by hand. Run `pnpm gen` to regenerate.

import { nextjsAsyncClientComponent } from "./../rules/nextjs/nextjs-async-client-component.js";
import { nextjsImageMissingSizes } from "./../rules/nextjs/nextjs-image-missing-sizes.js";
import { nextjsInlineScriptMissingId } from "./../rules/nextjs/nextjs-inline-script-missing-id.js";
import { nextjsMissingMetadata } from "./../rules/nextjs/nextjs-missing-metadata.js";
import { nextjsNoAElement } from "./../rules/nextjs/nextjs-no-a-element.js";
import { nextjsNoClientFetchForServerData } from "./../rules/nextjs/nextjs-no-client-fetch-for-server-data.js";
import { nextjsNoClientSideRedirect } from "./../rules/nextjs/nextjs-no-client-side-redirect.js";
import { nextjsNoCssLink } from "./../rules/nextjs/nextjs-no-css-link.js";
import { nextjsNoFontLink } from "./../rules/nextjs/nextjs-no-font-link.js";
import { nextjsNoHeadImport } from "./../rules/nextjs/nextjs-no-head-import.js";
import { nextjsNoImgElement } from "./../rules/nextjs/nextjs-no-img-element.js";
import { nextjsNoNativeScript } from "./../rules/nextjs/nextjs-no-native-script.js";
import { nextjsNoPolyfillScript } from "./../rules/nextjs/nextjs-no-polyfill-script.js";
import { nextjsNoRedirectInTryCatch } from "./../rules/nextjs/nextjs-no-redirect-in-try-catch.js";
import { nextjsNoSideEffectInGetHandler } from "./../rules/nextjs/nextjs-no-side-effect-in-get-handler.js";
import { nextjsNoUseSearchParamsWithoutSuspense } from "./../rules/nextjs/nextjs-no-use-search-params-without-suspense.js";

export const NextjsRuleEntries = [
  {
    key: "react-doctor/nextjs-async-client-component",
    id: "nextjs-async-client-component",
    source: "react-doctor",
    originallyExternal: false,
    framework: "nextjs",
    category: "Next.js",
    severity: "error",
    rule: {
      ...nextjsAsyncClientComponent,
      framework: "nextjs",
      category: "Next.js",
      requires: [...new Set(["nextjs", ...(nextjsAsyncClientComponent.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/nextjs-image-missing-sizes",
    id: "nextjs-image-missing-sizes",
    source: "react-doctor",
    originallyExternal: false,
    framework: "nextjs",
    category: "Next.js",
    severity: "warn",
    rule: {
      ...nextjsImageMissingSizes,
      framework: "nextjs",
      category: "Next.js",
      requires: [...new Set(["nextjs", ...(nextjsImageMissingSizes.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/nextjs-inline-script-missing-id",
    id: "nextjs-inline-script-missing-id",
    source: "react-doctor",
    originallyExternal: false,
    framework: "nextjs",
    category: "Next.js",
    severity: "warn",
    rule: {
      ...nextjsInlineScriptMissingId,
      framework: "nextjs",
      category: "Next.js",
      requires: [...new Set(["nextjs", ...(nextjsInlineScriptMissingId.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/nextjs-missing-metadata",
    id: "nextjs-missing-metadata",
    source: "react-doctor",
    originallyExternal: false,
    framework: "nextjs",
    category: "Next.js",
    severity: "warn",
    rule: {
      ...nextjsMissingMetadata,
      framework: "nextjs",
      category: "Next.js",
      requires: [...new Set(["nextjs", ...(nextjsMissingMetadata.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/nextjs-no-a-element",
    id: "nextjs-no-a-element",
    source: "react-doctor",
    originallyExternal: false,
    framework: "nextjs",
    category: "Next.js",
    severity: "warn",
    rule: {
      ...nextjsNoAElement,
      framework: "nextjs",
      category: "Next.js",
      requires: [...new Set(["nextjs", ...(nextjsNoAElement.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/nextjs-no-client-fetch-for-server-data",
    id: "nextjs-no-client-fetch-for-server-data",
    source: "react-doctor",
    originallyExternal: false,
    framework: "nextjs",
    category: "Next.js",
    severity: "warn",
    rule: {
      ...nextjsNoClientFetchForServerData,
      framework: "nextjs",
      category: "Next.js",
      requires: [...new Set(["nextjs", ...(nextjsNoClientFetchForServerData.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/nextjs-no-client-side-redirect",
    id: "nextjs-no-client-side-redirect",
    source: "react-doctor",
    originallyExternal: false,
    framework: "nextjs",
    category: "Next.js",
    severity: "warn",
    rule: {
      ...nextjsNoClientSideRedirect,
      framework: "nextjs",
      category: "Next.js",
      requires: [...new Set(["nextjs", ...(nextjsNoClientSideRedirect.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/nextjs-no-css-link",
    id: "nextjs-no-css-link",
    source: "react-doctor",
    originallyExternal: false,
    framework: "nextjs",
    category: "Next.js",
    severity: "warn",
    rule: {
      ...nextjsNoCssLink,
      framework: "nextjs",
      category: "Next.js",
      requires: [...new Set(["nextjs", ...(nextjsNoCssLink.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/nextjs-no-font-link",
    id: "nextjs-no-font-link",
    source: "react-doctor",
    originallyExternal: false,
    framework: "nextjs",
    category: "Next.js",
    severity: "warn",
    rule: {
      ...nextjsNoFontLink,
      framework: "nextjs",
      category: "Next.js",
      requires: [...new Set(["nextjs", ...(nextjsNoFontLink.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/nextjs-no-head-import",
    id: "nextjs-no-head-import",
    source: "react-doctor",
    originallyExternal: false,
    framework: "nextjs",
    category: "Next.js",
    severity: "error",
    rule: {
      ...nextjsNoHeadImport,
      framework: "nextjs",
      category: "Next.js",
      requires: [...new Set(["nextjs", ...(nextjsNoHeadImport.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/nextjs-no-img-element",
    id: "nextjs-no-img-element",
    source: "react-doctor",
    originallyExternal: false,
    framework: "nextjs",
    category: "Next.js",
    severity: "warn",
    rule: {
      ...nextjsNoImgElement,
      framework: "nextjs",
      category: "Next.js",
      requires: [...new Set(["nextjs", ...(nextjsNoImgElement.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/nextjs-no-native-script",
    id: "nextjs-no-native-script",
    source: "react-doctor",
    originallyExternal: false,
    framework: "nextjs",
    category: "Next.js",
    severity: "warn",
    rule: {
      ...nextjsNoNativeScript,
      framework: "nextjs",
      category: "Next.js",
      requires: [...new Set(["nextjs", ...(nextjsNoNativeScript.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/nextjs-no-polyfill-script",
    id: "nextjs-no-polyfill-script",
    source: "react-doctor",
    originallyExternal: false,
    framework: "nextjs",
    category: "Next.js",
    severity: "warn",
    rule: {
      ...nextjsNoPolyfillScript,
      framework: "nextjs",
      category: "Next.js",
      requires: [...new Set(["nextjs", ...(nextjsNoPolyfillScript.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/nextjs-no-redirect-in-try-catch",
    id: "nextjs-no-redirect-in-try-catch",
    source: "react-doctor",
    originallyExternal: false,
    framework: "nextjs",
    category: "Next.js",
    severity: "warn",
    rule: {
      ...nextjsNoRedirectInTryCatch,
      framework: "nextjs",
      category: "Next.js",
      requires: [...new Set(["nextjs", ...(nextjsNoRedirectInTryCatch.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/nextjs-no-side-effect-in-get-handler",
    id: "nextjs-no-side-effect-in-get-handler",
    source: "react-doctor",
    originallyExternal: false,
    framework: "nextjs",
    category: "Security",
    severity: "error",
    rule: {
      ...nextjsNoSideEffectInGetHandler,
      framework: "nextjs",
      category: "Security",
      requires: [...new Set(["nextjs", ...(nextjsNoSideEffectInGetHandler.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/nextjs-no-use-search-params-without-suspense",
    id: "nextjs-no-use-search-params-without-suspense",
    source: "react-doctor",
    originallyExternal: false,
    framework: "nextjs",
    category: "Next.js",
    severity: "warn",
    rule: {
      ...nextjsNoUseSearchParamsWithoutSuspense,
      framework: "nextjs",
      category: "Next.js",
      requires: [
        ...new Set(["nextjs", ...(nextjsNoUseSearchParamsWithoutSuspense.requires ?? [])]),
      ],
    },
  },
] as const;
