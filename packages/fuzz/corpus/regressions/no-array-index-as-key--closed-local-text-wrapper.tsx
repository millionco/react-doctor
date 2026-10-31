// rule: no-array-index-as-key
// weakness: wrapper-transparency
// source: independently invented closed wrapper with an unknown project profile
// verdict: fail
import React from "react";

const TextParcel = ({ children }) => <span>{children}</span>;

export const MineralStrip = () =>
  "amber|granite|mica"
    .split("|")
    .map((mineral, index) => <TextParcel key={index}>{mineral}</TextParcel>);
