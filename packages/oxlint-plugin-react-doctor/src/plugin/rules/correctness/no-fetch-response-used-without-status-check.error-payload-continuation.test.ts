import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noFetchResponseUsedWithoutStatusCheck } from "./no-fetch-response-used-without-status-check.js";

interface ErrorPayloadContinuationCase {
  name: string;
  code: string;
  expectedCount: number;
}

const cases: ErrorPayloadContinuationCase[] = [
  {
    name: "review-inherited-descriptor-getter-write",
    code: 'import {toast} from "sonner";export const load=async(commit:(value:unknown)=>void)=>{toast.__defineGetter__("error",()=>commit);const response=await fetch("/api/records");if(response.ok)return;const {error}=await response.json();toast.error(error);};',
    expectedCount: 1,
  },
  {
    name: "review-inherited-descriptor-setter-write",
    code: 'import {toast} from "sonner";export const load=async(commit:(value:unknown)=>void)=>{toast.__defineSetter__("error",commit);const response=await fetch("/api/records");if(response.ok)return;const {error}=await response.json();toast.error(error);};',
    expectedCount: 1,
  },
  {
    name: "review-ordinary-toast-method-control",
    code: 'import {toast} from "sonner";export const load=async(commit:(value:unknown)=>void)=>{toast.success("saved");const response=await fetch("/api/records");if(response.ok)return;const {error}=await response.json();toast.error(error);};',
    expectedCount: 0,
  },
  {
    name: "review-inherited-descriptor-read-control",
    code: 'import {toast} from "sonner";export const load=async(commit:(value:unknown)=>void)=>{toast.__lookupGetter__("error");const response=await fetch("/api/records");if(response.ok)return;const {error}=await response.json();toast.error(error);};',
    expectedCount: 0,
  },
  {
    name: "review-canonical",
    code: 'import {toast} from "sonner";export const load=async(commit:(value:unknown)=>void)=>{const response=await fetch("/api/records");if(response.ok)return;const {error}=await response.json();toast.error(error);};',
    expectedCount: 0,
  },
  {
    name: "review-merged-toast-interface",
    code: 'import {toast} from "sonner";interface toast {}export const load=async(commit:(value:unknown)=>void)=>{const response=await fetch("/api/records");if(response.ok)return;const {error}=await response.json();toast.error(error);};',
    expectedCount: 0,
  },
  {
    name: "review-masked-toast-write",
    code: 'import {toast} from "sonner";export const load=async(commit:(value:unknown)=>void)=>{const rewrite=()=>{interface toast{};toast.error=commit;};rewrite();const response=await fetch("/api/records");if(response.ok)return;const {error}=await response.json();toast.error(error);};',
    expectedCount: 1,
  },
  {
    name: "review-plain-toast-write",
    code: 'import {toast} from "sonner";export const load=async(commit:(value:unknown)=>void)=>{const rewrite=()=>{toast.error=commit;};rewrite();const response=await fetch("/api/records");if(response.ok)return;const {error}=await response.json();toast.error(error);};',
    expectedCount: 1,
  },
  {
    name: "review-masked-response-write",
    code: 'import {toast} from "sonner";export const load=async(commit:(value:unknown)=>void)=>{const response=await fetch("/api/records");const rewrite=()=>{interface response{};response.ok=true;};rewrite();if(response.ok)return;const {error}=await response.json();toast.error(error);};',
    expectedCount: 1,
  },
  {
    name: "review-plain-response-write",
    code: 'import {toast} from "sonner";export const load=async(commit:(value:unknown)=>void)=>{const response=await fetch("/api/records");const rewrite=()=>{response.ok=true;};rewrite();if(response.ok)return;const {error}=await response.json();toast.error(error);};',
    expectedCount: 1,
  },
  {
    name: "review-masked-error-escape",
    code: 'import {toast} from "sonner";export const load=async(commit:(value:unknown)=>void)=>{const response=await fetch("/api/records");if(response.ok)return;const {error}=await response.json();toast.error(error); {interface error{}; return error;}};',
    expectedCount: 1,
  },
  {
    name: "review-global-loader-write",
    code: 'import {toast} from "sonner";export const load=async(commit:(value:unknown)=>void)=>{require("sonner").toast.error=commit;const response=await fetch("/api/records");if(response.ok)return;const {error}=await response.json();toast.error(error);};',
    expectedCount: 1,
  },
  {
    name: "review-declared-require-provider-write",
    code: 'import {toast} from "sonner";declare const require:any;export const load=async(commit:(value:unknown)=>void)=>{require("sonner").toast.error=commit;const response=await fetch("/api/records");if(response.ok)return;const {error}=await response.json();toast.error(error);};',
    expectedCount: 1,
  },
  {
    name: "review-genuine-local-loader",
    code: 'import {toast} from "sonner";export const load=async(commit:(value:unknown)=>void)=>{const require=(_name:string)=>({toast:{error:commit}});require("sonner").toast.error=commit;const response=await fetch("/api/records");if(response.ok)return;const {error}=await response.json();toast.error(error);};',
    expectedCount: 0,
  },
  {
    name: "review-foreign-global-loader",
    code: 'import {toast} from "sonner";export const load=async(commit:(value:unknown)=>void)=>{require("foreign-module");const response=await fetch("/api/records");if(response.ok)return;const {error}=await response.json();toast.error(error);};',
    expectedCount: 0,
  },
  {
    name: "review-foreign-erased-loader",
    code: 'import {toast} from "sonner";declare const require:any;export const load=async(commit:(value:unknown)=>void)=>{require("foreign-module");const response=await fetch("/api/records");if(response.ok)return;const {error}=await response.json();toast.error(error);};',
    expectedCount: 0,
  },
  {
    name: "review-inert-erased-loader",
    code: 'import {toast} from "sonner";declare const require:any;export const load=async(commit:(value:unknown)=>void)=>{void require;typeof require;const response=await fetch("/api/records");if(response.ok)return;const {error}=await response.json();toast.error(error);};',
    expectedCount: 0,
  },
  {
    name: "review-global-carrier-provider-write",
    code: 'import {toast} from "sonner";export const load=async(commit:(value:unknown)=>void)=>{globalThis.require("sonner").toast.error=commit;const response=await fetch("/api/records");if(response.ok)return;const {error}=await response.json();toast.error(error);};',
    expectedCount: 1,
  },
  {
    name: "review-erased-global-carrier-provider-write",
    code: 'import {toast} from "sonner";declare const globalThis:any;export const load=async(commit:(value:unknown)=>void)=>{globalThis.require("sonner").toast.error=commit;const response=await fetch("/api/records");if(response.ok)return;const {error}=await response.json();toast.error(error);};',
    expectedCount: 1,
  },
  {
    name: "review-global-carrier-alias-write",
    code: 'import {toast} from "sonner";export const load=async(commit:(value:unknown)=>void)=>{const world=globalThis;world.require("sonner").toast.error=commit;const response=await fetch("/api/records");if(response.ok)return;const {error}=await response.json();toast.error(error);};',
    expectedCount: 1,
  },
  {
    name: "review-erased-global-carrier-alias-write",
    code: 'import {toast} from "sonner";declare const globalThis:any;export const load=async(commit:(value:unknown)=>void)=>{const world=globalThis;world.require("sonner").toast.error=commit;const response=await fetch("/api/records");if(response.ok)return;const {error}=await response.json();toast.error(error);};',
    expectedCount: 1,
  },
  {
    name: "review-erased-unrelated-carrier-member",
    code: 'import {toast} from "sonner";declare const globalThis:any;export const load=async(commit:(value:unknown)=>void)=>{void globalThis.unrelated;const response=await fetch("/api/records");if(response.ok)return;const {error}=await response.json();toast.error(error);};',
    expectedCount: 0,
  },
  {
    name: "review-foreign-erased-carrier-loader",
    code: 'import {toast} from "sonner";declare const globalThis:any;export const load=async(commit:(value:unknown)=>void)=>{globalThis.require("foreign-module");const response=await fetch("/api/records");if(response.ok)return;const {error}=await response.json();toast.error(error);};',
    expectedCount: 0,
  },
  {
    name: "review-inert-erased-carrier",
    code: 'import {toast} from "sonner";declare const globalThis:any;export const load=async(commit:(value:unknown)=>void)=>{void globalThis;typeof globalThis;void globalThis.require;const response=await fetch("/api/records");if(response.ok)return;const {error}=await response.json();toast.error(error);};',
    expectedCount: 0,
  },
  {
    name: "review-masked-type-only-sonner-alias",
    code: 'import {toast} from "sonner";import type * as notifications from "sonner";export const load=async(commit:(value:unknown)=>void)=>{const rewrite=()=>{interface notifications{};notifications.toast.error=commit;};rewrite();const response=await fetch("/api/records");if(response.ok)return;const {error}=await response.json();toast.error(error);};',
    expectedCount: 1,
  },
  {
    name: "review-unmasked-type-only-sonner-alias",
    code: 'import {toast} from "sonner";import type * as notifications from "sonner";export const load=async(commit:(value:unknown)=>void)=>{const rewrite=()=>{notifications.toast.error=commit;};rewrite();const response=await fetch("/api/records");if(response.ok)return;const {error}=await response.json();toast.error(error);};',
    expectedCount: 1,
  },
  {
    name: "review-genuine-shadow-type-only-sonner-alias",
    code: 'import {toast} from "sonner";import type * as notifications from "sonner";export const load=async(commit:(value:unknown)=>void)=>{const rewrite=()=>{const notifications={toast:{error:commit}};interface notifications{};notifications.toast.error=commit;};rewrite();const response=await fetch("/api/records");if(response.ok)return;const {error}=await response.json();toast.error(error);};',
    expectedCount: 0,
  },
  {
    name: "review-sonner-dynamic-import-provider-write",
    code: 'import {toast} from "sonner";export const load=async(commit:(value:unknown)=>void)=>{const notifications=await import("sonner");notifications.toast.error=commit;const response=await fetch("/api/records");if(response.ok)return;const {error}=await response.json();toast.error(error);};',
    expectedCount: 1,
  },
  {
    name: "review-foreign-dynamic-import",
    code: 'import {toast} from "sonner";export const load=async()=>{await import("foreign-module");const response=await fetch("/api/records");if(response.ok)return;const {error}=await response.json();toast.error(error);};',
    expectedCount: 0,
  },
  {
    name: "deliberate-error-only-continuation",
    code: 'import { toast } from "sonner";\nexport const loadRecord = async () => {\n  const response = await fetch("/api/records"); if (response.ok) { const payload = await response.json(); return { record: payload.record }; } const { error } = await response.json(); toast.error(error);\n};\n',
    expectedCount: 0,
  },
  {
    name: "renamed-error-and-import-bindings",
    code: 'import { toast as alerts } from "sonner";\nexport const loadRecord = async () => {\n  const response = await fetch("/api/records"); if (response.ok) { const payload = await response.json(); return { record: payload.record }; } const { error: failureText } = await response.json(); alerts.error(failureText);\n};\n',
    expectedCount: 0,
  },
  {
    name: "ordinary-try-body-failure-handler",
    code: 'import { toast } from "sonner";\nexport const loadRecord = async () => {\n  try { const response = await fetch("/api/records"); if (response.ok) { const payload = await response.json(); return { record: payload.record }; } const { error } = await response.json(); toast.error(error); } catch (failure) { toast.error("Could not load"); }\n};\n',
    expectedCount: 0,
  },
  {
    name: "bare-success-return-error-report",
    code: 'import { toast } from "sonner";\nexport const loadRecord = async () => {\n  const response = await fetch("/api/records"); if (response.ok) return; const { error } = await response.json(); toast.error(error);\n};\n',
    expectedCount: 0,
  },
  {
    name: "quoted-static-error-key",
    code: 'import { toast } from "sonner";\nexport const loadRecord = async () => {\n  const response = await fetch("/api/records"); if (response.ok) { const payload = await response.json(); return { record: payload.record }; } const { "error": failureText } = await response.json(); toast.error(failureText);\n};\n',
    expectedCount: 0,
  },
  {
    name: "missing-status-guard",
    code: 'import { toast } from "sonner";\nexport const loadRecord = async () => {\n  const response = await fetch("/api/records"); const { error } = await response.json(); toast.error(error);\n};\n',
    expectedCount: 1,
  },
  {
    name: "legacy-returned-failure-json",
    code: 'import { toast } from "sonner";\nexport const loadRecord = async () => {\n  const response = await fetch("/api/records"); if (response.ok) return; return response.json();\n};\n',
    expectedCount: 1,
  },
  {
    name: "legacy-failure-text-return",
    code: 'import { toast } from "sonner";\nexport const loadRecord = async () => {\n  const response = await fetch("/api/records"); if (response.ok) return response.json(); return response.text();\n};\n',
    expectedCount: 1,
  },
  {
    name: "success-branch-does-not-exit",
    code: 'import { toast } from "sonner";\nexport const loadRecord = async () => {\n  const response = await fetch("/api/records"); if (response.ok) { console.log("ready"); } const { error } = await response.json(); toast.error(error);\n};\n',
    expectedCount: 1,
  },
  {
    name: "success-exit-only-conditional",
    code: 'import { toast } from "sonner";\nexport const loadRecord = async (skip: boolean) => {\n  const response = await fetch("/api/records"); if (response.ok) { if (skip) return; } const { error } = await response.json(); toast.error(error);\n};\n',
    expectedCount: 1,
  },
  {
    name: "different-response-status",
    code: 'import { toast } from "sonner";\nexport const loadRecord = async (otherResponse: Response) => {\n  const response = await fetch("/api/records"); if (otherResponse.ok) return; const { error } = await response.json(); toast.error(error);\n};\n',
    expectedCount: 1,
  },
  {
    name: "error-read-by-success-handler",
    code: 'import { toast } from "sonner";\nexport const loadRecord = async () => {\n  const response = await fetch("/api/records"); if (response.ok) { const payload = await response.json(); return { record: payload.record }; } const { error } = await response.json(); toast.success(error);\n};\n',
    expectedCount: 1,
  },
  {
    name: "custom-error-method-disguises-success",
    code: 'export const loadRecord = async (commitSuccess: (value: unknown) => void) => {\n  const reporter = { error: commitSuccess }; const response = await fetch("/api/records"); if (response.ok) { const payload = await response.json(); return { record: payload.record }; } const { error } = await response.json(); reporter.error(error);\n};\n',
    expectedCount: 1,
  },
  {
    name: "error-payload-is-returned",
    code: 'import { toast } from "sonner";\nexport const loadRecord = async () => {\n  const response = await fetch("/api/records"); if (response.ok) { const payload = await response.json(); return { record: payload.record }; } const { error } = await response.json(); toast.error(error); return error;\n};\n',
    expectedCount: 1,
  },
  {
    name: "mutable-error-binding",
    code: 'import { toast } from "sonner";\nexport const loadRecord = async () => {\n  const response = await fetch("/api/records"); if (response.ok) { const payload = await response.json(); return { record: payload.record }; } let { error } = await response.json(); error = "ignored"; toast.error(error);\n};\n',
    expectedCount: 1,
  },
  {
    name: "extra-payload-field",
    code: 'import { toast } from "sonner";\nexport const loadRecord = async () => {\n  const response = await fetch("/api/records"); if (response.ok) { const payload = await response.json(); return { record: payload.record }; } const { error, record } = await response.json(); toast.error(error); return record;\n};\n',
    expectedCount: 1,
  },
  {
    name: "defaulted-error-field",
    code: 'import { toast } from "sonner";\nexport const loadRecord = async () => {\n  const response = await fetch("/api/records"); if (response.ok) { const payload = await response.json(); return { record: payload.record }; } const { error = "fallback" } = await response.json(); toast.error(error);\n};\n',
    expectedCount: 1,
  },
  {
    name: "rest-payload-extraction",
    code: 'import { toast } from "sonner";\nexport const loadRecord = async () => {\n  const response = await fetch("/api/records"); if (response.ok) { const payload = await response.json(); return { record: payload.record }; } const { error, ...remaining } = await response.json(); toast.error(error); return remaining;\n};\n',
    expectedCount: 1,
  },
  {
    name: "deferred-error-read",
    code: 'import { toast } from "sonner";\nexport const loadRecord = async (registerLater: (callback: () => void) => void) => {\n  const response = await fetch("/api/records"); if (response.ok) { const payload = await response.json(); return { record: payload.record }; } const { error } = await response.json(); registerLater(() => toast.error(error));\n};\n',
    expectedCount: 1,
  },
  {
    name: "type-only-toast-import",
    code: 'import type { toast } from "sonner";\nexport const loadRecord = async () => {\n  const response = await fetch("/api/records"); if (response.ok) { const payload = await response.json(); return { record: payload.record }; } const { error } = await response.json(); toast.error(error);\n};\n',
    expectedCount: 1,
  },
  {
    name: "secondary-value-toast-escape",
    code: 'import { toast } from "sonner";\nimport { toast as alerts } from "sonner";\nexport const loadRecord = async (consume: (value: unknown) => void) => {\n  consume(alerts); const response = await fetch("/api/records"); if (response.ok) { const payload = await response.json(); return { record: payload.record }; } const { error } = await response.json(); toast.error(error);\n};\n',
    expectedCount: 1,
  },
  {
    name: "another-unguarded-consumption",
    code: 'import { toast } from "sonner";\nexport const loadRecord = async () => {\n  const response = await fetch("/api/records"); if (response.ok) { const payload = await response.json(); return { record: payload.record }; } const { error } = await response.json(); toast.error(error); return response.text();\n};\n',
    expectedCount: 1,
  },
  {
    name: "legacy-error-status-exit",
    code: 'import { toast } from "sonner";\nexport const loadRecord = async () => {\n  const response = await fetch("/api/records"); if (!response.ok) throw new Error("failed"); return response.json();\n};\n',
    expectedCount: 0,
  },
  {
    name: "legacy-inline-failure-consumption",
    code: 'import { toast } from "sonner";\nexport const loadRecord = async () => {\n  const response = await fetch("/api/records"); if (!response.ok) { const { error } = await response.json(); toast.error(error); return; } return response.json();\n};\n',
    expectedCount: 0,
  },
  {
    name: "error-loop-write",
    code: 'import { toast } from "sonner";\nexport const loadRecord = async (replacements: string[]) => {\n  const response = await fetch("/api/records"); if (response.ok) { const payload = await response.json(); return { record: payload.record }; } const { error } = await response.json(); for (error of replacements) {} toast.error(error);\n};\n',
    expectedCount: 1,
  },
  {
    name: "source-visible-eval-identifier",
    code: 'import { toast } from "sonner";\nexport const loadRecord = async () => {\n  void eval; const response = await fetch("/api/records"); if (response.ok) { const payload = await response.json(); return { record: payload.record }; } const { error } = await response.json(); toast.error(error);\n};\n',
    expectedCount: 1,
  },
  {
    name: "runtime-enum-write-profile",
    code: 'import { toast } from "sonner";\nexport const loadRecord = async () => {\n  const response = await fetch("/api/records"); if (response.ok) { const payload = await response.json(); return { record: payload.record }; } const { error } = await response.json(); enum Outcome { Entry = (response.ok = true, 1) } toast.error(error);\n};\n',
    expectedCount: 1,
  },
  {
    name: "mixed-inline-type-toast",
    code: 'import { type toast, Toaster } from "sonner";\nexport const loadRecord = async () => {\n  const response = await fetch("/api/records"); if (response.ok) { const payload = await response.json(); return { record: payload.record }; } const { error } = await response.json(); toast.error(error);\n};\n',
    expectedCount: 1,
  },
  {
    name: "visible-response-member-write",
    code: 'import { toast } from "sonner";\nexport const loadRecord = async () => {\n  const response = await fetch("/api/records"); response.ok = true; if (response.ok) { const payload = await response.json(); return { record: payload.record }; } const { error } = await response.json(); toast.error(error);\n};\n',
    expectedCount: 1,
  },
  {
    name: "visible-toast-error-write",
    code: 'import { toast } from "sonner";\nexport const loadRecord = async (commitSuccess: (value: unknown) => string) => {\n  toast.error = commitSuccess; const response = await fetch("/api/records"); if (response.ok) { const payload = await response.json(); return { record: payload.record }; } const { error } = await response.json(); toast.error(error);\n};\n',
    expectedCount: 1,
  },
  {
    name: "shadowed-global-fetch",
    code: 'import { toast } from "sonner";\nexport const loadRecord = async (fetch: typeof globalThis.fetch) => {\n  const response = await fetch("/api/records"); if (response.ok) { const payload = await response.json(); return { record: payload.record }; } const { error } = await response.json(); toast.error(error);\n};\n',
    expectedCount: 0,
  },
  {
    name: "nested-shadow-error-binding",
    code: 'import { toast } from "sonner";\nexport const loadRecord = async () => {\n  const response = await fetch("/api/records"); if (response.ok) { const payload = await response.json(); return { record: payload.record }; } const { error } = await response.json(); { const error = "unrelated"; toast.error(error); } return error;\n};\n',
    expectedCount: 1,
  },
  {
    name: "default-sonner-runtime-carrier",
    code: 'import notifications, { toast } from "sonner";\nexport const loadRecord = async (consume: (value: unknown) => void) => {\n  consume(notifications); const response = await fetch("/api/records"); if (response.ok) { const payload = await response.json(); return { record: payload.record }; } const { error } = await response.json(); toast.error(error);\n};\n',
    expectedCount: 1,
  },
  {
    name: "namespace-sonner-runtime-carrier",
    code: 'import * as notifications from "sonner";\nimport { toast } from "sonner";\nexport const loadRecord = async (consume: (value: unknown) => void) => {\n  consume(notifications); const response = await fetch("/api/records"); if (response.ok) { const payload = await response.json(); return { record: payload.record }; } const { error } = await response.json(); toast.error(error);\n};\n',
    expectedCount: 1,
  },
  {
    name: "named-default-sonner-runtime-carrier",
    code: 'import { default as notifications, toast } from "sonner";\nexport const loadRecord = async (consume: (value: unknown) => void) => {\n  consume(notifications); const response = await fetch("/api/records"); if (response.ok) { const payload = await response.json(); return { record: payload.record }; } const { error } = await response.json(); toast.error(error);\n};\n',
    expectedCount: 1,
  },
  {
    name: "unused-sonner-namespace",
    code: 'import * as notifications from "sonner";\nimport { toast } from "sonner";\nexport const loadRecord = async () => {\n  const response = await fetch("/api/records"); if (response.ok) { const payload = await response.json(); return { record: payload.record }; } const { error } = await response.json(); toast.error(error);\n};\n',
    expectedCount: 0,
  },
  {
    name: "unrelated-sonner-named-hook",
    code: 'import { toast, useSonner } from "sonner";\nexport const loadRecord = async () => {\n  const response = await fetch("/api/records"); if (response.ok) { const payload = await response.json(); return { record: payload.record }; } const { error } = await response.json(); toast.error(error);\n};\n',
    expectedCount: 0,
  },
  {
    name: "erased-toast-query",
    code: 'import { toast } from "sonner";\ntype Notice = typeof toast;\nexport const loadRecord = async () => {\n  const response = await fetch("/api/records"); if (response.ok) { const payload = await response.json(); return { record: payload.record }; } const { error } = await response.json(); toast.error(error);\n};\n',
    expectedCount: 0,
  },
  {
    name: "shadowed-toast-parameter",
    code: 'import { toast } from "sonner";\nexport const loadRecord = async (notifications: { error: (value: unknown) => void }) => {\n  const response = await fetch("/api/records"); if (response.ok) { const payload = await response.json(); return { record: payload.record }; } const { error } = await response.json(); notifications.error(error);\n};\n',
    expectedCount: 1,
  },
  {
    name: "nested-error-write",
    code: 'import { toast } from "sonner";\nexport const loadRecord = async () => {\n  const response = await fetch("/api/records"); if (response.ok) { const payload = await response.json(); return { record: payload.record }; } const { error } = await response.json(); const overwrite = () => { error = "replacement"; }; overwrite(); toast.error(error);\n};\n',
    expectedCount: 1,
  },
  {
    name: "logical-success-test",
    code: 'import { toast } from "sonner";\nexport const loadRecord = async (bypass: boolean) => {\n  const response = await fetch("/api/records"); if (response.ok || bypass) return; const { error } = await response.json(); toast.error(error);\n};\n',
    expectedCount: 1,
  },
  {
    name: "comparison-success-test",
    code: 'import { toast } from "sonner";\nexport const loadRecord = async () => {\n  const response = await fetch("/api/records"); if (response.ok === true) return; const { error } = await response.json(); toast.error(error);\n};\n',
    expectedCount: 1,
  },
  {
    name: "response-const-alias",
    code: 'import { toast } from "sonner";\nexport const loadRecord = async () => {\n  const response = await fetch("/api/records"); const checked = response; if (checked.ok) return; const { error } = await response.json(); toast.error(error);\n};\n',
    expectedCount: 1,
  },
  {
    name: "another-json-result-consumer",
    code: 'import { toast } from "sonner";\nexport const loadRecord = async () => {\n  const response = await fetch("/api/records"); if (response.ok) { const payload = await response.json(); return { record: payload.record }; } const { error } = await response.json(); toast.error(error); const body = await response.json(); return body;\n};\n',
    expectedCount: 1,
  },
  {
    name: "unused-error-binding",
    code: 'import { toast } from "sonner";\nexport const loadRecord = async () => {\n  const response = await fetch("/api/records"); if (response.ok) { const payload = await response.json(); return { record: payload.record }; } const { error } = await response.json(); return;\n};\n',
    expectedCount: 1,
  },
  {
    name: "two-error-api-reports",
    code: 'import { toast } from "sonner";\nexport const loadRecord = async () => {\n  const response = await fetch("/api/records"); if (response.ok) { const payload = await response.json(); return { record: payload.record }; } const { error } = await response.json(); toast.error(error); toast.error(error);\n};\n',
    expectedCount: 0,
  },
  {
    name: "optional-error-api-call",
    code: 'import { toast } from "sonner";\nexport const loadRecord = async () => {\n  const response = await fetch("/api/records"); if (response.ok) { const payload = await response.json(); return { record: payload.record }; } const { error } = await response.json(); toast.error?.(error);\n};\n',
    expectedCount: 1,
  },
  {
    name: "spread-error-api-argument",
    code: 'import { toast } from "sonner";\nexport const loadRecord = async () => {\n  const response = await fetch("/api/records"); if (response.ok) { const payload = await response.json(); return { record: payload.record }; } const { error } = await response.json(); toast.error(...[error]);\n};\n',
    expectedCount: 1,
  },
  {
    name: "returned-nested-function-is-not-success-exit",
    code: 'import { toast } from "sonner";\nexport const loadRecord = async () => {\n  const response = await fetch("/api/records"); if (response.ok) { const finish = () => { return; }; finish(); } const { error } = await response.json(); toast.error(error);\n};\n',
    expectedCount: 1,
  },
  {
    name: "loop-ancestor",
    code: 'import { toast } from "sonner";\nexport const loadRecord = async (items: unknown[]) => {\n  for (const item of items) { const response = await fetch("/api/records"); if (response.ok) { const payload = await response.json(); return { record: payload.record }; } const { error } = await response.json(); toast.error(error); void item; }\n};\n',
    expectedCount: 1,
  },
  {
    name: "eval-in-other-function",
    code: 'import { toast } from "sonner";\nexport const inspectScope = () => { void eval; };\nexport const loadRecord = async () => {\n  const response = await fetch("/api/records"); if (response.ok) { const payload = await response.json(); return { record: payload.record }; } const { error } = await response.json(); toast.error(error);\n};\n',
    expectedCount: 1,
  },
  {
    name: "runtime-enum-outside-owner",
    code: 'import { toast } from "sonner";\nenum State { Ready = 1 }\nexport const loadRecord = async () => {\n  const response = await fetch("/api/records"); if (response.ok) { const payload = await response.json(); return { record: payload.record }; } const { error } = await response.json(); toast.error(error);\n};\n',
    expectedCount: 1,
  },
  {
    name: "erased-interface-unrelated",
    code: 'import { toast } from "sonner";\ninterface Detail { message: string; }\nexport const loadRecord = async () => {\n  const response = await fetch("/api/records"); if (response.ok) { const payload = await response.json(); return { record: payload.record }; } const { error } = await response.json(); toast.error(error);\n};\n',
    expectedCount: 0,
  },
  {
    name: "toast-member-extraction",
    code: 'import { toast } from "sonner";\nexport const loadRecord = async () => {\n  const reportError = toast.error; const response = await fetch("/api/records"); if (response.ok) { const payload = await response.json(); return { record: payload.record }; } const { error } = await response.json(); reportError(error);\n};\n',
    expectedCount: 1,
  },
  {
    name: "mutable-response-declarator",
    code: 'import { toast } from "sonner";\nexport const loadRecord = async () => {\n  let response = await fetch("/api/records"); if (response.ok) { const payload = await response.json(); return { record: payload.record }; } const { error } = await response.json(); toast.error(error);\n};\n',
    expectedCount: 1,
  },
  {
    name: "catch-ancestor",
    code: 'import { toast } from "sonner";\nexport const loadRecord = async () => {\n  try { throw new Error("start"); } catch (failure) { const response = await fetch("/api/records"); if (response.ok) { const payload = await response.json(); return { record: payload.record }; } const { error } = await response.json(); toast.error(error); }\n};\n',
    expectedCount: 1,
  },
  {
    name: "direct-return-before-error-report",
    code: 'import { toast } from "sonner";\nexport const loadRecord = async () => {\n  const response = await fetch("/api/records"); if (response.ok) { const payload = await response.json(); return { record: payload.record }; } const { error } = await response.json(); return; toast.error(error);\n};\n',
    expectedCount: 1,
  },
  {
    name: "direct-throw-before-error-report",
    code: 'import { toast } from "sonner";\nexport const loadRecord = async () => {\n  const response = await fetch("/api/records"); if (response.ok) { const payload = await response.json(); return { record: payload.record }; } const { error } = await response.json(); throw new Error("stopped"); toast.error(error);\n};\n',
    expectedCount: 1,
  },
  {
    name: "known-condition-return-before-error-report",
    code: 'import { toast } from "sonner";\nexport const loadRecord = async () => {\n  const shouldStop = true; const response = await fetch("/api/records"); if (response.ok) { const payload = await response.json(); return { record: payload.record }; } const { error } = await response.json(); if (shouldStop) return; toast.error(error);\n};\n',
    expectedCount: 1,
  },
  {
    name: "interface-eval-runtime-reference",
    code: 'interface eval {}\neval("void 0");\nimport { toast } from "sonner";\nexport const loadRecord = async () => {\n  const response = await fetch("/api/records"); if (response.ok) { const payload = await response.json(); return { record: payload.record }; } const { error } = await response.json(); toast.error(error);\n};\n',
    expectedCount: 1,
  },
  {
    name: "type-alias-eval-runtime-reference",
    code: 'type eval = () => unknown;\neval("void 0");\nimport { toast } from "sonner";\nexport const loadRecord = async () => {\n  const response = await fetch("/api/records"); if (response.ok) { const payload = await response.json(); return { record: payload.record }; } const { error } = await response.json(); toast.error(error);\n};\n',
    expectedCount: 1,
  },
  {
    name: "type-import-eval-runtime-reference",
    code: 'import type { eval } from "./types";\neval("void 0");\nimport { toast } from "sonner";\nexport const loadRecord = async () => {\n  const response = await fetch("/api/records"); if (response.ok) { const payload = await response.json(); return { record: payload.record }; } const { error } = await response.json(); toast.error(error);\n};\n',
    expectedCount: 1,
  },
  {
    name: "inline-type-import-eval-runtime-reference",
    code: 'import { type eval, otherValue } from "./types";\neval("void 0");\nimport { toast } from "sonner";\nexport const loadRecord = async () => {\n  const response = await fetch("/api/records"); if (response.ok) { const payload = await response.json(); return { record: payload.record }; } const { error } = await response.json(); toast.error(error);\n};\n',
    expectedCount: 1,
  },
  {
    name: "unused-erased-eval-declaration",
    code: 'interface eval {}\nimport { toast } from "sonner";\nexport const loadRecord = async () => {\n  const response = await fetch("/api/records"); if (response.ok) { const payload = await response.json(); return { record: payload.record }; } const { error } = await response.json(); toast.error(error);\n};\n',
    expectedCount: 0,
  },
];

describe("failed-status error payload continuation", () => {
  it.each(cases)("$name", ({ code, expectedCount }) => {
    const result = runRule(noFetchResponseUsedWithoutStatusCheck, code, {
      filename: "src/error-payload-continuation.tsx",
      settings: { "react-doctor": { portedRuleMode: "curated" } },
      includeLocations: true,
      forceJsx: false,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedCount);
  });
});
