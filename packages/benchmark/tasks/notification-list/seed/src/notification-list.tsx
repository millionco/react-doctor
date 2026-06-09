export interface Notification {
  id: string;
  message: string;
}

export interface NotificationListProps {
  notifications: Notification[];
}

// TODO(agent): implement. See instruction.md.
export const NotificationList = (_props: NotificationListProps) => {
  throw new Error("not implemented");
};
