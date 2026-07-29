interface StatusProperties {
  label: string;
}

const memo = <Component,>(
  component: Component,
  comparator: (previousValue: unknown, nextValue: unknown) => boolean,
): Component => {
  comparator(null, null);
  return component;
};

const StatusView = ({ label }: StatusProperties) => <output>{label}</output>;

export const Status = memo(StatusView, () => true);
