import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { expect, it } from "vite-plus/test";
import { parseFixture } from "../../../test-utils/parse-fixture.js";
import { runRuleOnParsedFixture } from "../../../test-utils/run-rule.js";
import { resetFilesystemCaches } from "../../utils/reset-filesystem-caches.js";
import { iframeMissingSandbox } from "./iframe-missing-sandbox.js";
import { DEFERRED_IFRAME_MAX_WORK_GROWTH_RATIO } from "./utils/constants.js";

it("bounds module lookup work as source modules and known callers grow", () => {
  const callbackMeasurements: number[] = [];
  for (const moduleCount of [32, 128]) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-module-index-growth-"));
    try {
      const sourceDirectory = path.join(directory, "src");
      fs.mkdirSync(sourceDirectory);
      fs.writeFileSync(
        path.join(directory, "package.json"),
        '{"private":true,"dependencies":{"react":"19.0.0","react-dom":"19.0.0"}}',
      );
      const source =
        "import React,{useRef} from 'react';\nconst Preview=()=>{const frame=useRef(null);const open=()=>{const container=document.querySelector('#preview');container.querySelector('.carrier > iframe').setAttribute('src','https://media.example/video');};return <div id=\"preview\"><div className=\"carrier\"><iframe ref={frame}/></div><button onClick={open}>Open</button></div>;};\nexport const Gallery=({values})=>values.map(()=> <Preview/>);\n";
      const filename = path.join(sourceDirectory, "preview.tsx");
      fs.writeFileSync(filename, source);
      for (let moduleIndex = 0; moduleIndex < moduleCount - 2; moduleIndex++) {
        fs.writeFileSync(
          path.join(sourceDirectory, `a-padding-${String(moduleIndex).padStart(3, "0")}.ts`),
          `export const marker${moduleIndex}=${moduleIndex};\n`,
        );
      }
      fs.writeFileSync(
        path.join(sourceDirectory, "zz-consumer.tsx"),
        `import {Gallery} from './preview';export const Surface=()=> <>${"<Gallery values={[1]}/>".repeat(moduleCount)}</>;\n`,
      );
      expect(fs.readdirSync(sourceDirectory)).toHaveLength(moduleCount);
      resetFilesystemCaches();
      const parsed = parseFixture(source, { filename });
      expect(parsed.errors).toEqual([]);
      const descriptor = Object.getOwnPropertyDescriptor(Array.prototype, "find");
      if (!descriptor || typeof descriptor.value !== "function") {
        throw new Error("Native Array.find descriptor unavailable");
      }
      let callbacks = 0;
      const observedFind = new Proxy(descriptor.value, {
        apply: (originalFind, receiver, argumentValues) => {
          const callback = argumentValues[0];
          if (typeof callback !== "function") {
            return Reflect.apply(originalFind, receiver, argumentValues);
          }
          const forwardedArguments = [...argumentValues];
          forwardedArguments[0] = (...callbackArguments: unknown[]) => {
            callbacks++;
            return Reflect.apply(callback, argumentValues[1], callbackArguments);
          };
          return Reflect.apply(originalFind, receiver, forwardedArguments);
        },
      });
      const calibrationArray = [1, , 2, 3];
      const calibrationContext = {};
      const calibrationCalls: unknown[] = [];
      const calibrationCallback = new Proxy((value: unknown) => value === 2, {
        apply: (callback, receiver, argumentValues) => {
          calibrationCalls.push({
            value: argumentValues[0],
            index: argumentValues[1],
            sameArray: argumentValues[2] === calibrationArray,
            sameContext: receiver === calibrationContext,
            arguments: argumentValues.length,
          });
          return Reflect.apply(callback, receiver, argumentValues);
        },
      });
      expect(
        Reflect.apply(observedFind, calibrationArray, [calibrationCallback, calibrationContext]),
      ).toBe(2);
      expect(calibrationCalls).toEqual([
        { value: 1, index: 0, sameArray: true, sameContext: true, arguments: 3 },
        { value: undefined, index: 1, sameArray: true, sameContext: true, arguments: 3 },
        { value: 2, index: 2, sameArray: true, sameContext: true, arguments: 3 },
      ]);
      const sentinel = new Error("find callback sentinel");
      let thrown: unknown;
      try {
        Reflect.apply(
          observedFind,
          [1],
          [
            () => {
              throw sentinel;
            },
          ],
        );
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBe(sentinel);
      callbacks = 0;
      let result;
      try {
        Object.defineProperty(Array.prototype, "find", { ...descriptor, value: observedFind });
        result = runRuleOnParsedFixture(iframeMissingSandbox, source, parsed, {
          filename,
          settings: { "react-doctor": { rootDirectory: directory } },
        });
      } finally {
        Object.defineProperty(Array.prototype, "find", descriptor);
      }
      expect(Object.getOwnPropertyDescriptor(Array.prototype, "find")).toEqual(descriptor);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
      callbackMeasurements.push(callbacks);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
      resetFilesystemCaches();
    }
  }
  expect(callbackMeasurements).toHaveLength(2);
  const [smallCallbacks, largeCallbacks] = callbackMeasurements;
  if (smallCallbacks === undefined || largeCallbacks === undefined) {
    throw new Error("Missing module lookup growth measurements");
  }
  expect(largeCallbacks).toBeLessThanOrEqual(
    Math.max(1, smallCallbacks) * DEFERRED_IFRAME_MAX_WORK_GROWTH_RATIO,
  );
});
