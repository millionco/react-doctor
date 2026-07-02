import { describe, expect, it } from "vite-plus/test";
import type { ReactDoctorConfig } from "@react-doctor/core";
import { isShareOptedOut } from "../src/cli/utils/is-share-opted-out.js";

const scan = (config: ReactDoctorConfig | null) => ({ config });

describe("isShareOptedOut", () => {
  it("stays opted in when every project has no opt-out and no flag", () => {
    expect(isShareOptedOut([scan(null), scan({}), scan({ share: true })], undefined)).toBe(false);
  });

  it("opts out when the flag (--no-score / --no-telemetry) is set", () => {
    expect(isShareOptedOut([scan({}), scan({})], true)).toBe(true);
  });

  it("opts out when ANY single project's merged config has noScore", () => {
    expect(isShareOptedOut([scan({}), scan({ noScore: true }), scan({})], undefined)).toBe(true);
  });

  it("opts out when ANY single project sets share: false", () => {
    expect(isShareOptedOut([scan({ share: false }), scan({})], undefined)).toBe(true);
  });

  it("treats share: undefined as opted in (only explicit false opts out)", () => {
    expect(isShareOptedOut([scan({ noScore: false })], undefined)).toBe(false);
  });
});
