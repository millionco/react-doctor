// rule: no-random-key
// verdict: fail
// weakness: provider-erasure
// source: independently synthetic binding namespace control
const globalThis = { note: 0 };
interface globalThis {}
globalThis.note = 1;
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
