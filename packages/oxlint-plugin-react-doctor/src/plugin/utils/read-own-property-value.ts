export const readOwnPropertyValue = (value: object, propertyName: string): unknown =>
  Object.getOwnPropertyDescriptor(value, propertyName)?.value;
