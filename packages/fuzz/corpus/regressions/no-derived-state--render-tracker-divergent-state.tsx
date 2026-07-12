// rule: no-derived-state
// weakness: control-flow
// source: react-bench RD-FN-010 Divz, FloatingSheet, and Brainly adjudication

import { useRef, useState } from "react";

export const Divz = ({ isExpanded, autoPlay }: { isExpanded: boolean; autoPlay: boolean }) => {
  const previousIsExpanded = useRef(isExpanded);
  const previousAutoPlay = useRef(autoPlay);
  const [expanded, setExpanded] = useState(isExpanded);
  const [playing, setPlaying] = useState(autoPlay);

  if (previousIsExpanded.current !== isExpanded) {
    previousIsExpanded.current = isExpanded;
    setExpanded(isExpanded);
  }
  if (previousAutoPlay.current !== autoPlay) {
    previousAutoPlay.current = autoPlay;
    setPlaying(autoPlay);
  }

  return (
    <button
      onClick={() => setExpanded((current) => !current)}
      onDoubleClick={() => setPlaying((current) => !current)}
    >
      {expanded && playing ? "playing" : "paused"}
    </button>
  );
};

export const RadioGroup = ({ value }: { value: string }) => {
  const previousValue = useRef(value);
  const [selectedValue, setSelectedValue] = useState(value);

  if (value !== previousValue.current) {
    previousValue.current = value;
    setSelectedValue(value);
  }

  return <button onClick={() => setSelectedValue("other")}>{selectedValue}</button>;
};

export const FloatingSheet = ({
  isOpen,
  restingHeight,
}: {
  isOpen: boolean;
  restingHeight: number;
}) => {
  const previousOpen = useRef(isOpen);
  const [height, setHeight] = useState(restingHeight);

  if (isOpen !== previousOpen.current) {
    previousOpen.current = isOpen;
    if (isOpen) {
      setHeight(restingHeight);
    } else {
      setHeight(0);
    }
  }

  return <div onPointerMove={(event) => setHeight(event.clientY)}>{height}</div>;
};
