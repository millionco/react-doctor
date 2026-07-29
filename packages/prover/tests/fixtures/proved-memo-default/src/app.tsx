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

export const Profile = memo(ProfileView);
