import { memo } from "react";

interface ProfileProperties {
  name: string;
  revision: number;
}

const ProfileView = ({ name, revision }: ProfileProperties) => (
  <p>
    {name} revision {revision}
  </p>
);

export const Profile = memo(
  ProfileView,
  (previousProperties, nextProperties) =>
    previousProperties.name === nextProperties.name &&
    Object.is(previousProperties.revision, nextProperties.revision),
);
