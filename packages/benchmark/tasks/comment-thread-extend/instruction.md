`src/comment-thread.tsx` renders a list of comments. Extend it.

## Expected behavior

Each comment list item must now also show its reply count. Render each comment's
text as exactly:

```
<author>: <text> (<replies> replies)
```

For example a comment `{ author: "Ada", text: "Hello", replies: 2 }` renders a
`<li>` whose text content is `Ada: Hello (2 replies)`.

Keep the existing `<ul className="thread">` wrapper and render one `<li>` per
comment, in order.

## Constraints

Keep the exported `CommentThread` component and the `Comment` /
`CommentThreadProps` types.
