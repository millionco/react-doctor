export interface Notification {
  id: string;
  message: string;
}

export interface NotificationListProps {
  notifications: Notification[];
}

export const NotificationList = ({ notifications }: NotificationListProps) => (
  <ul className="notifications">
    {notifications.map((notification) => (
      <li key={notification.id}>{notification.message}</li>
    ))}
  </ul>
);
