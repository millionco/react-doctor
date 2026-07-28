import { expect, test } from "@playwright/test";
import { FORM_STATUS_ACTION_EXPECTED_RUNS } from "./constants.js";

test("Form Status observes only a parent form during a Strict Mode Action", async ({ page }) => {
  await page.goto("/?oracle=form-status");

  await page.getByRole("textbox", { name: "Username" }).fill("alice");
  await page.getByRole("button", { name: "request username" }).click();

  await expect(page.getByTestId("form-status-pending")).toHaveText("true");
  await expect(page.getByTestId("same-component-form-status")).toHaveText("false");
  await expect(page.getByTestId("form-status-data")).toHaveText("alice");
  await expect(page.getByTestId("form-status-method")).toHaveText("get");
  await expect(page.getByTestId("form-status-action")).toHaveText("true");
  await expect
    .poll(() => page.evaluate(() => window.formStatusActionRuns))
    .toBe(FORM_STATUS_ACTION_EXPECTED_RUNS);
  await expect(page.getByTestId("form-status-pending")).toHaveText("false");
});
