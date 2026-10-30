import type { SeededRandom } from "./seeded-random.js";

export const buildOwnedCarouselFuzzScenario = (random: SeededRandom): string => {
  const scenario = random.pick([
    "owned",
    "type-only-export",
    "missing-destroy",
    "extension-escape",
    "erased-intrinsic-capability",
    "aliased-intrinsic-capability",
  ]);
  return [
    scenario === "aliased-intrinsic-capability"
      ? `const fuzzIntrinsicTools = ${random.pick(["Object", "Reflect"])}; fuzzIntrinsicTools.getPrototypeOf([]).forEach = () => {};`
      : "",
    scenario === "erased-intrinsic-capability"
      ? "interface Object { text?: string; } Object.getPrototypeOf([]).forEach = () => {};"
      : "",
    'import { Component as FuzzCarouselBase } from "react";',
    'import { Splide as FuzzCarouselDeck } from "@splidejs/splide";',
    "export class FuzzOwnedCarousel extends FuzzCarouselBase {",
    "  deck: FuzzCarouselDeck | undefined;",
    "  componentDidMount() {",
    '    this.deck = new FuzzCarouselDeck("#gallery");',
    '    this.deck.on("ready", () => {});',
    scenario === "extension-escape"
      ? "    this.deck.mount({ Patch: instance => { instance.destroy = () => {}; return {}; } });"
      : "    this.deck.mount();",
    "  }",
    "  componentWillUnmount() {",
    "    if (this.deck) {",
    scenario === "missing-destroy" ? "" : "      this.deck.destroy();",
    "      this.deck = undefined;",
    "    }",
    "  }",
    "  render() { return null; }",
    "}",
    scenario === "type-only-export"
      ? "export type { FuzzCarouselDeck as FuzzCarouselHandle };"
      : "",
  ]
    .filter(Boolean)
    .join("\n");
};
