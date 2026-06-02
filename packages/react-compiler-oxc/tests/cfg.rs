//! Backing tests for the control-flow outline. Each case pins the exact
//! source-anchored output so the rendering stays stable and behavior-faithful.

use react_compiler_oxc::print_control_flow;

/// Join outline lines into the trailing-newline-terminated form the printer
/// emits, keeping the expectations readable.
fn outline(lines: &[&str]) -> String {
    let mut joined = lines.join("\n");
    joined.push('\n');
    joined
}

#[test]
fn branch_with_early_return() {
    let source = r#"export function A({show}) {
  const label = 'x';
  if (show) {
    return null;
  }
  return <div>{label}</div>;
}
"#;
    let expected = outline(&[
        "A",
        "run L2",
        "if (show)  L3  «if (show) {»",
        "  then:",
        "    return  L4  «return null;»",
        "return  L6  «return <div>{label}</div>;»",
    ]);
    assert_eq!(print_control_flow(source, "A.tsx"), expected);
}

#[test]
fn loop_and_switch() {
    let source = r#"export function B({mode, items}) {
  for (const item of items) {
    console.log(item);
  }
  switch (mode) {
    case 'a':
      return 1;
    default:
      return 2;
  }
}
"#;
    let expected = outline(&[
        "B",
        "loop for-of  L2  «for (const item of items) {»",
        "  run L3",
        "switch (mode)  L5  «switch (mode) {»",
        "  case 'a':",
        "    return  L7  «return 1;»",
        "  default:",
        "    return  L9  «return 2;»",
    ]);
    assert_eq!(print_control_flow(source, "B.tsx"), expected);
}

#[test]
fn nested_effect_callbacks() {
    let source = r#"import {useEffect, useState} from 'react';

export function Counter({start, label}) {
  const [count, setCount] = useState(start);
  const config = {label};

  useEffect(() => {
    const id = setInterval(() => {
      setCount((value) => value + 1);
    }, 1000);
    return () => clearInterval(id);
  }, [config]);

  if (count > 10) {
    return <strong>{label} done</strong>;
  }
  return <div>{label}: {count}</div>;
}
"#;
    let expected = outline(&[
        "Counter",
        "run L4-7",
        "  ↳ arrow fn  L7  «useEffect(() => {»",
        "    run L8",
        "      ↳ arrow fn  L8  «const id = setInterval(() => {»",
        "        run L9",
        "          ↳ arrow fn  L9  «setCount((value) => value + 1);»",
        "            return  L9  «setCount((value) => value + 1);»",
        "    return  L11  «return () => clearInterval(id);»",
        "      ↳ arrow fn  L11  «return () => clearInterval(id);»",
        "        return  L11  «return () => clearInterval(id);»",
        "if (count > 10)  L14  «if (count > 10) {»",
        "  then:",
        "    return  L15  «return <strong>{label} done</strong>;»",
        "return  L17  «return <div>{label}: {count}</div>;»",
    ]);
    assert_eq!(print_control_flow(source, "Counter.tsx"), expected);
}

#[test]
fn arrow_component_with_else() {
    let source = r#"const Toggle = ({on}) => {
  if (on) {
    return <span>on</span>;
  } else {
    return <span>off</span>;
  }
};
"#;
    let expected = outline(&[
        "Toggle",
        "if (on)  L2  «if (on) {»",
        "  then:",
        "    return  L3  «return <span>on</span>;»",
        "  else:",
        "    return  L5  «return <span>off</span>;»",
    ]);
    assert_eq!(print_control_flow(source, "Toggle.tsx"), expected);
}

#[test]
fn multiple_components() {
    let source = r#"export function First() {
  return null;
}
export function Second() {
  return null;
}
"#;
    let expected = outline(&[
        "First",
        "return  L2  «return null;»",
        "",
        "Second",
        "return  L5  «return null;»",
    ]);
    assert_eq!(print_control_flow(source, "Pair.tsx"), expected);
}
