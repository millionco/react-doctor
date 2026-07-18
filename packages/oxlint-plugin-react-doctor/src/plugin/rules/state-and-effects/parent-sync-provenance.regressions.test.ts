import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noPassDataToParent } from "./no-pass-data-to-parent.js";
import { noPassLiveStateToParent } from "./no-pass-live-state-to-parent.js";
import { noPropCallbackInEffect } from "./no-prop-callback-in-effect.js";

interface ParentSyncProvenanceCase {
  code: string;
  name: string;
}

const mustReportCases: ParentSyncProvenanceCase[] = [
  {
    name: "direct prop callbacks",
    code: `import { useEffect, useState } from "react";
      const Child = ({ onChange }) => {
        const [value] = useState(0);
        useEffect(() => onChange(buildPayload(value)), [onChange, value]);
        return null;
      };`,
  },
  {
    name: "direct React useEffectEvent wrappers",
    code: `import { useEffect, useEffectEvent, useState } from "react";
      const Child = ({ onChange }) => {
        const [value] = useState(0);
        const notify = useEffectEvent(onChange);
        useEffect(() => notify(buildPayload(value)), [value]);
        return null;
      };`,
  },
  {
    name: "namespace React useEffectEvent member wrappers",
    code: `import * as React from "react";
      const Child = (props) => {
        const [value] = React.useState(0);
        const notify = React.useEffectEvent(props.onChange);
        React.useEffect(() => notify(buildPayload(value)), [value]);
        return null;
      };`,
  },
  {
    name: "direct React useCallback wrappers",
    code: `import { useCallback, useEffect, useState } from "react";
      const Child = ({ onChange }) => {
        const [value] = useState(0);
        const notify = useCallback(onChange, [onChange]);
        useEffect(() => notify(buildPayload(value)), [notify, value]);
        return null;
      };`,
  },
  {
    name: "inline React useEffectEvent wrappers",
    code: `import { useEffect, useEffectEvent, useState } from "react";
      const Child = ({ onChange }) => {
        const [value] = useState(0);
        const notify = useEffectEvent((nextValue) => onChange(nextValue));
        useEffect(() => notify(buildPayload(value)), [value]);
        return null;
      };`,
  },
  {
    name: "immutable callback aliases",
    code: `import { useEffect, useState } from "react";
      const Child = ({ onChange }) => {
        const [value] = useState(0);
        const notify = onChange;
        useEffect(() => notify(buildPayload(value)), [notify, value]);
        return null;
      };`,
  },
  {
    name: "ref-held callbacks",
    code: `import { useEffect, useRef, useState } from "react";
      const Child = ({ onChange }) => {
        const [value] = useState(0);
        const notifyRef = useRef(onChange);
        useEffect(() => {
          notifyRef.current = onChange;
        }, [onChange]);
        useEffect(() => notifyRef.current(buildPayload(value)), [value]);
        return null;
      };`,
  },
  {
    name: "conditional callback aliases",
    code: `import { useEffect, useState } from "react";
      const Child = ({ onChange, onFallback, preferFallback }) => {
        const [value] = useState(0);
        const notify = preferFallback ? onFallback : onChange;
        useEffect(() => notify(buildPayload(value)), [notify, value]);
        return null;
      };`,
  },
  {
    name: "logical callback aliases",
    code: `import { useEffect, useState } from "react";
      const Child = ({ onChange, onFallback }) => {
        const [value] = useState(0);
        const notify = onChange || onFallback;
        useEffect(() => notify(buildPayload(value)), [notify, value]);
        return null;
      };`,
  },
  {
    name: "object-property callback aliases",
    code: `import { useEffect, useState } from "react";
      const Child = ({ onChange }) => {
        const [value] = useState(0);
        const callbacks = { notify: onChange };
        useEffect(() => callbacks.notify(buildPayload(value)), [callbacks, value]);
        return null;
      };`,
  },
  {
    name: "prop-initialized custom-hook state",
    code: `import { useEffect, useState } from "react";
      const useCounter = (initialValue) => {
        const [value] = useState(initialValue);
        return value;
      };
      const Child = ({ initialValue, onChange }) => {
        const value = useCounter(initialValue);
        useEffect(() => onChange(buildPayload(value)), [onChange, value]);
        return null;
      };`,
  },
  {
    name: "the React PhoneNr Input benchmark bypass",
    code: `import { useEffect, useEffectEvent } from "react";
      import { usePhonenumber } from "./use-phonenumber";
      const PhoneInput = ({ format, initialCountry, initialValue, onChange, withCountryMeta }) => {
        const { country, phoneNumber } = usePhonenumber({
          format,
          initialCountry,
          initialValue,
        });
        const notify = useEffectEvent(onChange);
        useEffect(() => {
          const data = withCountryMeta ? { country, phoneNumber } : phoneNumber;
          notify(data);
        }, [country, phoneNumber, withCountryMeta]);
        return null;
      };`,
  },
];

const expectAllParentSyncRulesToReport = (code: string): void => {
  const results = [
    runRule(noPassDataToParent, code),
    runRule(noPassLiveStateToParent, code),
    runRule(noPropCallbackInEffect, code),
  ];
  for (const result of results) {
    expect(result.parseErrors).toEqual([]);
  }
  expect(results.map((result) => result.diagnostics.length)).toEqual([1, 1, 1]);
};

describe("parent-sync provenance matrix", () => {
  for (const testCase of mustReportCases) {
    it(`preserves ${testCase.name}`, () => {
      expectAllParentSyncRulesToReport(testCase.code);
    });
  }

  const mustNotReportCases: ParentSyncProvenanceCase[] = [
    {
      name: "userland useEffectEvent wrappers",
      code: `import { useEffect, useState } from "react";
        const useEffectEvent = (callback) => callback;
        const Child = ({ onChange }) => {
          const [value] = useState(0);
          const notify = useEffectEvent(onChange);
          useEffect(() => notify(buildPayload(value)), [notify, value]);
          return null;
        };`,
    },
    {
      name: "mutable callback aliases",
      code: `import { useEffect, useState } from "react";
        const Child = ({ onChange }) => {
          const [value] = useState(0);
          let notify = onChange;
          notify = console.log;
          useEffect(() => notify(buildPayload(value)), [notify, value]);
          return null;
        };`,
    },
    {
      name: "mixed parent and local callback branches",
      code: `import { useEffect, useState } from "react";
        const Child = ({ onChange, preferLocal }) => {
          const [value] = useState(0);
          const notify = preferLocal ? onChange : console.log;
          useEffect(() => notify(buildPayload(value)), [notify, value]);
          return null;
        };`,
    },
  ];

  for (const testCase of mustNotReportCases) {
    it(`rejects ${testCase.name}`, () => {
      const results = [
        runRule(noPassDataToParent, testCase.code),
        runRule(noPassLiveStateToParent, testCase.code),
        runRule(noPropCallbackInEffect, testCase.code),
      ];
      for (const result of results) {
        expect(result.parseErrors).toEqual([]);
        expect(result.diagnostics).toEqual([]);
      }
    });
  }
});
