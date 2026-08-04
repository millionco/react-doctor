import { expect, test } from "@playwright/test";

test("a pending use resource reveals its Suspense fallback and then its value", async ({
  page,
}) => {
  await page.goto("/?oracle=use-resource");

  await expect(page.getByTestId("use-resource-pending")).toHaveText("resource pending");
  await page.getByRole("button", { name: "resolve resource" }).click();
  await expect(page.getByTestId("use-resource-content")).toHaveText("resource ready");
  await expect(page.getByTestId("use-resource-pending")).toHaveCount(0);
});

test("a rejected use resource is contained by its Error Boundary", async ({ page }) => {
  await page.goto("/?oracle=use-resource");

  await expect(page.getByTestId("use-resource-pending")).toHaveText("resource pending");
  await page.getByRole("button", { name: "reject resource" }).click();
  await expect(page.getByTestId("use-resource-error")).toHaveText("resource unavailable");
  await expect(page.getByTestId("use-resource-content")).toHaveCount(0);
});
