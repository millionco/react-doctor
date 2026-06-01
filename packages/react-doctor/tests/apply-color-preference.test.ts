import { afterAll, afterEach, beforeAll, describe, expect, it } from "vite-plus/test";
import { highlighter, setColorEnabled } from "@react-doctor/core";
import { applyColorPreference } from "../src/cli/utils/apply-color-preference.js";

const hasAnsi = (text: string): boolean => text.includes("\u001B[");

// `setColorEnabled` mutates a process-wide singleton, so each case runs
// from an explicit state and the original (ambient) state is restored
// afterwards, keeping this file from leaking forced color into others.
let originalColorEnabled = false;

beforeAll(() => {
  originalColorEnabled = hasAnsi(highlighter.info("x"));
});

afterAll(() => {
  setColorEnabled(originalColorEnabled);
});

afterEach(() => {
  setColorEnabled(originalColorEnabled);
});

describe("applyColorPreference", () => {
  it("disables color when --no-color is present", () => {
    setColorEnabled(true);
    applyColorPreference(["node", "react-doctor", ".", "--no-color"]);
    expect(hasAnsi(highlighter.info("x"))).toBe(false);
  });

  it("forces color on when --color is present", () => {
    setColorEnabled(false);
    applyColorPreference(["node", "react-doctor", ".", "--color"]);
    expect(hasAnsi(highlighter.info("x"))).toBe(true);
  });

  it("leaves the current color state untouched when neither flag is passed", () => {
    setColorEnabled(false);
    applyColorPreference(["node", "react-doctor", "."]);
    expect(hasAnsi(highlighter.info("x"))).toBe(false);
  });

  it("lets the last flag win when both are passed", () => {
    setColorEnabled(true);
    applyColorPreference(["node", "react-doctor", "--color", "--no-color"]);
    expect(hasAnsi(highlighter.info("x"))).toBe(false);
  });

  it("ignores color flags that appear after the -- end-of-options marker", () => {
    setColorEnabled(true);
    applyColorPreference(["node", "react-doctor", "--", "--no-color"]);
    expect(hasAnsi(highlighter.info("x"))).toBe(true);
  });

  it("honors REACT_DOCTOR_NO_COLOR when no flag is passed", () => {
    setColorEnabled(true);
    applyColorPreference(["node", "react-doctor", "."], { REACT_DOCTOR_NO_COLOR: "1" });
    expect(hasAnsi(highlighter.info("x"))).toBe(false);
  });

  it("honors REACT_DOCTOR_FORCE_COLOR when no flag is passed", () => {
    setColorEnabled(false);
    applyColorPreference(["node", "react-doctor", "."], { REACT_DOCTOR_FORCE_COLOR: "1" });
    expect(hasAnsi(highlighter.info("x"))).toBe(true);
  });

  it("lets an explicit flag win over the env var", () => {
    setColorEnabled(false);
    applyColorPreference(["node", "react-doctor", "--color"], { REACT_DOCTOR_NO_COLOR: "1" });
    expect(hasAnsi(highlighter.info("x"))).toBe(true);
  });

  it("treats an empty env value as unset", () => {
    setColorEnabled(true);
    applyColorPreference(["node", "react-doctor", "."], { REACT_DOCTOR_NO_COLOR: "" });
    expect(hasAnsi(highlighter.info("x"))).toBe(true);
  });
});
