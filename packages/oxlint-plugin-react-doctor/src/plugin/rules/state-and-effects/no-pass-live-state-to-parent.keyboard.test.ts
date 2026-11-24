import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { hasVerifiedViteKeyboardRegistration } from "../../utils/has-verified-vite-keyboard-registration.js";
import { noPassLiveStateToParent } from "./no-pass-live-state-to-parent.js";

vi.mock("../../utils/has-verified-vite-keyboard-registration.js", () => ({
  hasVerifiedViteKeyboardRegistration: vi.fn(),
}));

const source = `
  import { useCallback, useEffect, useState } from "react";
  import { register, release } from "./keys.js";

  export function Picker({ onChange }) {
    const [value] = useState("first");
    const setup = useCallback(() => {
      const notify = () => onChange(value);
      register({ accept: () => notify() });
    }, [onChange, value]);
    useEffect(() => {
      setup();
      return release;
    }, [setup]);
    return <div />;
  }
`;

beforeEach(() => {
  vi.mocked(hasVerifiedViteKeyboardRegistration).mockReset().mockReturnValue(true);
});

describe("deferred keyboard notifications from an effect", () => {
  it("excludes the deferred action and its private helper from the setup call", () => {
    const result = runRule(noPassLiveStateToParent, source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
    const verification = vi.mocked(hasVerifiedViteKeyboardRegistration).mock.calls;
    expect(verification).toHaveLength(1);
    expect(verification[0]?.[0]).toMatchObject({ source: "./keys.js", exportedName: "register" });
  });

  it("keeps a report for a registrar whose build is unverified", () => {
    vi.mocked(hasVerifiedViteKeyboardRegistration).mockReturnValue(false);
    expect(runRule(noPassLiveStateToParent, source).diagnostics).toHaveLength(1);
  });

  it.each([
    ["immediate notification", "register({", "onChange(value); register({"],
    ["synchronous dispatch after setup", "return release;", 'trigger("accept"); return release;'],
    ["spread callback object", "register({", "register({ ...handlers,"],
    ["computed callback property", "accept: () =>", "[key]: () =>"],
  ])("keeps the warning for %s", (_description, from, to) => {
    const result = runRule(noPassLiveStateToParent, source.replace(from, to));
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(hasVerifiedViteKeyboardRegistration).not.toHaveBeenCalled();
  });
});
