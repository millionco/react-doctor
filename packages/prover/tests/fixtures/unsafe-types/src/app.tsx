interface GreetingProperties {
  value: unknown;
}

export const Greeting = ({ value }: GreetingProperties) => {
  const name = value as string;
  return <p>Hello {name}</p>;
};
