import { test, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NotificationList, type Notification } from "../src/notification-list.tsx";

const NOTIFICATIONS: Notification[] = [
  { id: "a", message: "Saved" },
  { id: "b", message: "Deleted" },
  { id: "c", message: "Shared" },
];

test("renders one list item per notification, in order", () => {
  const html = renderToStaticMarkup(<NotificationList notifications={NOTIFICATIONS} />);
  expect(html).toContain('<ul class="notifications">');
  const items = html.match(/<li[^>]*>/g) ?? [];
  expect(items).toHaveLength(3);
  expect(html.indexOf("Saved")).toBeLessThan(html.indexOf("Deleted"));
  expect(html).toContain("Shared");
});

test("renders an empty list without items", () => {
  const html = renderToStaticMarkup(<NotificationList notifications={[]} />);
  expect(html).toContain('<ul class="notifications">');
  expect(html).not.toContain("<li");
});
