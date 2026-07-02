/**
 * Regression: the controlled/uncontrolled component pattern must not be
 * flagged as a faked event handler (`no-event-handler`) or as derived
 * state (`no-derived-state`).
 *
 * Surfaced by scanning real component libraries (Innovaccer design-system,
 * lobe-ui, Victory) whose inputs support both controlled and uncontrolled
 * usage:
 *
 *   const [value, setValue] = useState(valueProp ?? defaultValue);
 *   useEffect(() => {
 *     if (valueProp !== undefined) setValue(valueProp); // sync to controlled prop
 *   }, [valueProp]);
 *   const onChange = (event) => setValue(event.target.value); // user edits
 *
 * The effect only mirrors the controlled prop into editable local state;
 * it neither folds an event-handler side effect away nor copies a value
 * that could be derived while rendering (a `useMemo` would erase the
 * user's keystrokes). Both rules must stay silent here while still firing
 * on the genuine anti-patterns.
 */

import { describe, expect, it } from "vite-plus/test";
import { createScopedTempRoot, collectRuleHits, setupReactProject } from "./_helpers.js";

const tempRoot = createScopedTempRoot("controlled-sync");

const CONTROLLED_INPUT = `import { useEffect, useState } from "react";

export const ControlledInput = ({
  value: valueProp,
  defaultValue,
  onChange,
}: {
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
}) => {
  const [value, setValue] = useState(valueProp ?? defaultValue ?? "");

  useEffect(() => {
    if (valueProp !== undefined) setValue(valueProp);
  }, [valueProp]);

  return (
    <input
      value={value}
      onChange={(event) => {
        setValue(event.target.value);
        onChange?.(event.target.value);
      }}
    />
  );
};
`;

describe("controlled/uncontrolled sync — no false positives", () => {
  it("does NOT flag no-event-handler on the controlled-prop sync effect", async () => {
    const projectDir = setupReactProject(tempRoot, "ev-controlled", {
      files: { "src/controlled-input.tsx": CONTROLLED_INPUT },
    });
    const hits = await collectRuleHits(projectDir, "no-event-handler");
    expect(hits).toHaveLength(0);
  });

  it("does NOT flag no-derived-state on editable state mirrored from a prop", async () => {
    const projectDir = setupReactProject(tempRoot, "ds-controlled", {
      files: { "src/controlled-input.tsx": CONTROLLED_INPUT },
    });
    const hits = await collectRuleHits(projectDir, "no-derived-state");
    expect(hits).toHaveLength(0);
  });

  it("DOES still flag no-event-handler when the effect runs a non-setter side effect", async () => {
    const projectDir = setupReactProject(tempRoot, "ev-true-positive", {
      files: {
        "src/form.tsx": `import { useEffect, useState } from "react";

declare const submitData: (data: unknown) => void;

export const Form = () => {
  const [dataToSubmit, setDataToSubmit] = useState<unknown>(null);

  useEffect(() => {
    if (dataToSubmit) {
      submitData(dataToSubmit);
    }
  }, [dataToSubmit]);

  return <button onClick={() => setDataToSubmit({ ok: true })}>Submit</button>;
};
`,
      },
    });
    const hits = await collectRuleHits(projectDir, "no-event-handler");
    expect(hits.length).toBeGreaterThan(0);
  });

  it("DOES still flag no-derived-state when state is only set from a derived value", async () => {
    const projectDir = setupReactProject(tempRoot, "ds-true-positive", {
      files: {
        "src/hotkey.tsx": `import { useEffect, useState } from "react";

declare const splitKeys: (keys: string) => string[];

export const Hotkey = ({ keys }: { keys: string }) => {
  const [keysGroup, setKeysGroup] = useState<string[]>(() => splitKeys(keys));

  useEffect(() => {
    setKeysGroup(splitKeys(keys));
  }, [keys]);

  return <span>{keysGroup.join("+")}</span>;
};
`,
      },
    });
    const hits = await collectRuleHits(projectDir, "no-derived-state");
    expect(hits.length).toBeGreaterThan(0);
  });
});
