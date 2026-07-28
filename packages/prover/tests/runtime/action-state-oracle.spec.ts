import { expect, test } from "@playwright/test";
import { ACTION_STATE_EXPECTED_RUNS } from "./constants.js";

test("Action State queues submissions and preserves pending state under Strict Mode", async ({
  page,
}) => {
  await page.goto("/?oracle=action-state");

  const itemInput = page.getByRole("textbox");
  await itemInput.fill("first");
  await page.getByRole("button", { name: "submit item" }).click();
  await itemInput.fill("second");
  await page.getByRole("button", { name: "submit item" }).click();

  await expect(page.getByTestId("action-state-pending")).toHaveText("true");
  await expect
    .poll(() => page.evaluate(() => window.actionStateRuns))
    .toBe(ACTION_STATE_EXPECTED_RUNS);
  await expect(page.getByTestId("action-state-items")).toHaveText("first|second");
  await expect(page.getByTestId("action-state-pending")).toHaveText("false");
});
