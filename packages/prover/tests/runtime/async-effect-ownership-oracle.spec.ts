import { expect, test } from "@playwright/test";
import { LATE_QUERY_SETTLE_WAIT_MS } from "./constants.js";

test("an unowned async Effect completion overwrites the newer result", async ({ page }) => {
  await page.goto("/?oracle=async-effect-ownership&mode=unsafe");
  await page.getByRole("button", { name: "load beta" }).click();

  await expect(page.getByTestId("async-query-result")).toHaveText("beta");
  await expect(page.getByTestId("async-query-result")).toHaveText("alpha");
});

test("cleanup invalidation prevents a superseded async Effect from committing", async ({
  page,
}) => {
  await page.goto("/?oracle=async-effect-ownership&mode=safe");
  await page.getByRole("button", { name: "load beta" }).click();

  await expect(page.getByTestId("async-query-result")).toHaveText("beta");
  await page.waitForTimeout(LATE_QUERY_SETTLE_WAIT_MS);
  await expect(page.getByTestId("async-query-result")).toHaveText("beta");
});
