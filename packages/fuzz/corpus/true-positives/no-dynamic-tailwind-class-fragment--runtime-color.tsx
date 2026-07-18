export const DynamicColor = ({ color }: { color: string }) => (
  <div className={`bg-${color}-500 text-${color}-100`} />
);
