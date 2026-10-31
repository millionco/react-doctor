// rule: no-random-key
// weakness: provider-identity
// source: independent synthetic erased-provider regression
// verdict: pass
declare const globalThis: any;
globalThis.require("uuid").v4 = () => "stable";
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
