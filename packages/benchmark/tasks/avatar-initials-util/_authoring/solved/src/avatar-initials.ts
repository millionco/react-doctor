// Up to two uppercase initials (first + last word) for an avatar badge.
export const avatarInitials = (fullName: string): string => {
  const words = fullName.trim().split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0) return "";

  const firstWord = words[0] ?? "";
  const lastWord = words[words.length - 1] ?? "";
  const initials = words.length === 1 ? firstWord[0] : `${firstWord[0]}${lastWord[0]}`;
  return initials.toUpperCase();
};
