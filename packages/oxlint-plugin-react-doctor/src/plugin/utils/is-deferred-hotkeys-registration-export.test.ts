import { describe, expect, it } from "vite-plus/test";
import { isDeferredHotkeysRegistrationExport } from "./is-deferred-hotkeys-registration-export.js";

const source = `
  import bind from "hotkeys-js";
  const acceptKey = "enter";
  const keys = [acceptKey, "space"];
  const relay = (keys, callback) => bind(keys, callback);
  export const register = (handlers) => {
    relay(keys.join(), (event) => { handlers.accept(event); });
  };
  export const release = () => bind.unbind(keys.join());
`;

const matches = (code: string): boolean =>
  isDeferredHotkeysRegistrationExport("/keys.ts", code, "register");

describe("static hotkeys registration export", () => {
  it("allows a private static key list and a transparent import relay", () => {
    expect(matches(source)).toBe(true);
  });

  it.each([
    ['"hotkeys-js"', '"replacement"'],
    [
      "export const register",
      "document.addEventListener = notifyDuringRegistration; export const register",
    ],

    ["const keys = [acceptKey", "const keys = [unknown"],
    ["export const register", 'keys.push("escape"); export const register'],
    ["relay(keys.join()", "handlers.accept(); relay(keys.join()"],
    ["bind(keys, callback)", "bind(keys, callback())"],
    ["(event) => { handlers.accept(event); }", "handlers.accept()"],
  ])("rejects setup work outside the stock registration contract", (from, to) => {
    expect(matches(source.replace(from, to))).toBe(false);
  });
});
