import { afterEach, describe, expect, it } from "vite-plus/test";
import { getDoctorProduct } from "../src/cli/utils/doctor-product.js";

const previousProduct = process.env.REACT_DOCTOR_PRODUCT;

afterEach(() => {
  if (previousProduct === undefined) delete process.env.REACT_DOCTOR_PRODUCT;
  else process.env.REACT_DOCTOR_PRODUCT = previousProduct;
});

describe("getDoctorProduct", () => {
  it("falls back to React Doctor for unset and unknown products", () => {
    delete process.env.REACT_DOCTOR_PRODUCT;
    expect(getDoctorProduct()).toMatchObject({
      packageName: "react-doctor",
      displayName: "React Doctor",
      includedTags: [],
    });

    process.env.REACT_DOCTOR_PRODUCT = "untrusted-doctor";
    expect(getDoctorProduct().packageName).toBe("react-doctor");
  });

  it.each([
    ["tui-doctor", "TUI Doctor", ["ink"]],
    ["ui-doctor", "UI Doctor", ["design"]],
    ["threejs-doctor", "Three.js Doctor", ["three", "r3f"]],
  ])("resolves the %s launcher", (packageName, displayName, includedTags) => {
    process.env.REACT_DOCTOR_PRODUCT = packageName;
    const product = getDoctorProduct();
    expect(product.displayName).toBe(displayName);
    expect(product.includedTags).toEqual(includedTags);
    expect(product.includedTags.length).toBeGreaterThan(0);
  });
});
