import { Fragment } from "react";

interface Props {
  readonly className?: string;
}

interface Props {
  readonly text: string;
}

export const CharacterList = ({ text }: Props) => (
  <Fragment>
    {[...text].map((character, index) => (
      <span key={index}>{character}</span>
    ))}
  </Fragment>
);
