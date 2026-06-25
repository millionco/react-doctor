import { describe, expect, it } from "vite-plus/test";
import { generatePlaywrightTest } from "../src/utils/generate-playwright-test.js";

describe("generatePlaywrightTest", () => {
  it("awaits a bare expression and navigates to the captured URL", () => {
    const source = generatePlaywrightTest({
      url: "http://localhost:3000/checkout",
      expression: 'page.getByRole("button", { name: "Pay" }).click()',
    });
    expect(source).toContain('import { expect, test } from "@playwright/test";');
    expect(source).toContain('test("eval on /checkout"');
    expect(source).toContain('await page.goto("http://localhost:3000/checkout");');
    expect(source).toContain('await page.getByRole("button", { name: "Pay" }).click();');
    expect(source).toContain("expect(pageErrors, pageErrors.join");
  });

  it("inlines multi-statement source without wrapping it in await", () => {
    const source = generatePlaywrightTest({
      url: "http://localhost:3000/",
      expression: "const title = await page.title();\nawait page.getByText(title).click();",
    });
    expect(source).toContain("  const title = await page.title();");
    expect(source).toContain("  await page.getByText(title).click();");
    expect(source).not.toContain("await const");
  });

  it("falls back to a generic name when the URL is not parseable", () => {
    const source = generatePlaywrightTest({ url: "", expression: "page.title()" });
    expect(source).toContain('test("eval interaction"');
  });
});
