// rule: no-static-element-interactions
// weakness: wrapper-transparency
// source: React Bench fix-react-rdh-trendyol-react-carousel-index

interface CarouselKeyboardProps {
  useArrowKeys: boolean;
  handleOnKeyDown: () => void;
}

export const DirectKeyboardCarousel = ({
  useArrowKeys,
  handleOnKeyDown,
}: CarouselKeyboardProps) => <div onKeyDown={useArrowKeys ? handleOnKeyDown : undefined} />;

export const SpreadKeyboardCarousel = ({
  useArrowKeys,
  handleOnKeyDown,
}: CarouselKeyboardProps) => <div {...(useArrowKeys ? { onKeyDown: handleOnKeyDown } : {})} />;
