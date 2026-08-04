import { memo } from "react";

interface User {
  id: string;
  name: string;
}

interface UserProperties {
  user: User;
}

const UserView = ({ user }: UserProperties) => <output>{user.name}</output>;

export const UserName = memo(
  UserView,
  (previousProperties, nextProperties) => previousProperties.user.id === nextProperties.user.id,
);
