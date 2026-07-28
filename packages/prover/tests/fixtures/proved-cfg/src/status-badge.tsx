interface StatusBadgeProperties {
  isOnline: boolean;
}

export const StatusBadge = ({ isOnline }: StatusBadgeProperties) => {
  const label = isOnline ? "online" : "offline";
  return <span>{label}</span>;
};
