Implement the `NotificationList` component in `src/notification-list.tsx`.

## Expected behavior

`NotificationList` takes a `notifications` array (each item is
`{ id: string; message: string }`) and renders:

- A `<ul className="notifications">` wrapper.
- One `<li>` per notification, in order, whose text content is the
  notification's `message`.

Example: `<NotificationList notifications={[{ id: "a", message: "Saved" }]} />`
renders `<ul class="notifications"><li>Saved</li></ul>`.

## Constraints

Keep the exported `NotificationList` component and the `Notification` /
`NotificationListProps` types.
