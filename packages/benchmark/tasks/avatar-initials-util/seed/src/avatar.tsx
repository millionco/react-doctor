import { avatarInitials } from "./avatar-initials.ts";

interface AvatarProps {
  fullName: string;
}

// Existing consumer (keeps avatar-initials.ts reachable). Do not edit.
export const Avatar = ({ fullName }: AvatarProps) => (
  <span className="avatar" aria-label={fullName}>
    {avatarInitials(fullName)}
  </span>
);
