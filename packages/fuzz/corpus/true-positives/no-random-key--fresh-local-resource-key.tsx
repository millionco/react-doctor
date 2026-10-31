// rule: no-random-key
// weakness: local-resource-origin
// source: independently synthetic local resource key
// verdict: fail
import { v4 as makeKey } from "uuid";
const makeCards = () => [{ token: makeKey(), label: "Ready" }];
const Cards = () => {
  const cards = makeCards();
  return (
    <>
      {cards.map((card) => (
        <span key={card.token}>{card.label}</span>
      ))}
    </>
  );
};
export const Example = () => <Cards />;
