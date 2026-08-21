export const getR3fConstructorName = (elementType: string): string =>
  `${elementType[0]?.toUpperCase()}${elementType.slice(1)}`;
