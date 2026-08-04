import { expect, test } from "@playwright/test";
import { STRICT_MODE_CONSTRUCTION_RUNS } from "./constants.js";

test("Strict Mode constructs constructor and public-field state twice", async ({ page }) => {
  await page.goto("/?oracle=class-construction");

  await expect
    .poll(() => page.evaluate(() => window.classConstructorRuns))
    .toBe(STRICT_MODE_CONSTRUCTION_RUNS);
  await expect
    .poll(() => page.evaluate(() => window.classFieldInitializerRuns))
    .toBe(STRICT_MODE_CONSTRUCTION_RUNS);
  await expect(page.getByTestId("constructor-run")).toHaveText(
    String(STRICT_MODE_CONSTRUCTION_RUNS),
  );
  await expect(page.getByTestId("field-initializer-run")).toHaveText(
    String(STRICT_MODE_CONSTRUCTION_RUNS),
  );
});
