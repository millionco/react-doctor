export const Example = ({ text }: { text: string }) => (
  <span>
    {text.split(" ").map((part, index) => {
      interface text {}
      void text;
      return (
        <span key={index}>
          <b>{part.split("=")[1]}</b>
        </span>
      );
    })}
  </span>
);
