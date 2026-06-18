export const Get =
  (route: string) =>
  (target: unknown, propertyKey: string, descriptor: PropertyDescriptor): void => {
    void target;
    void propertyKey;
    void route;
    void descriptor;
  };

export const Internal =
  () =>
  (target: unknown, propertyKey: string, descriptor: PropertyDescriptor): void => {
    void target;
    void propertyKey;
    void descriptor;
  };
