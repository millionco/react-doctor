import { describe, expect, it } from "vite-plus/test";
import {
  NoReactDependencyError,
  PackageJsonNotFoundError,
  ProjectNotFoundError,
  ReactDoctorError,
  isReactDoctorError,
} from "../src/errors.js";

describe("errors", () => {
  it("identifies ReactDoctorError instances", () => {
    expect(isReactDoctorError(new ReactDoctorError("boom"))).toBe(true);
    expect(isReactDoctorError(new Error("boom"))).toBe(false);
    expect(isReactDoctorError(null)).toBe(false);
  });

  it("stores directory metadata on project errors", () => {
    expect(new ProjectNotFoundError("/repo").directory).toBe("/repo");
    expect(new NoReactDependencyError("/repo").directory).toBe("/repo");
    expect(new PackageJsonNotFoundError("/repo").directory).toBe("/repo");
  });
});
