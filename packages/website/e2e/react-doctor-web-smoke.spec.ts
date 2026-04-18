import { expect, test } from "@playwright/test";

test("client bundle executes react-doctor-web calculateScoreLocally", async ({ page }) => {
  await page.goto("/dev/react-doctor-web-smoke");
  const locator = page.getByTestId("core-smoke-result");
  await expect(locator).toBeVisible();
  const text = await locator.textContent();
  expect(text).toBeTruthy();
  const parsed = JSON.parse(text!) as { score: number; label: string };
  expect(typeof parsed.score).toBe("number");
  expect(typeof parsed.label).toBe("string");
  expect(parsed.label.length).toBeGreaterThan(0);
});
