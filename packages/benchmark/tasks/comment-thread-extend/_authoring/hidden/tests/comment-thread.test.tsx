import { test, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CommentThread, type Comment } from "../src/comment-thread.tsx";

const COMMENTS: Comment[] = [
  { id: "c1", author: "Ada", text: "Hello", replies: 2 },
  { id: "c2", author: "Grace", text: "Nice", replies: 0 },
];

test("renders each comment with its reply count, in order", () => {
  const html = renderToStaticMarkup(<CommentThread comments={COMMENTS} />);
  expect(html).toContain('<ul class="thread">');
  expect(html).toContain("Ada: Hello (2 replies)");
  expect(html).toContain("Grace: Nice (0 replies)");
  expect(html.indexOf("Ada")).toBeLessThan(html.indexOf("Grace"));
  expect(html.match(/<li>/g) ?? []).toHaveLength(2);
});
