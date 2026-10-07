import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noInertPointerAffordance } from "./no-inert-pointer-affordance.js";

describe("no-inert-pointer-affordance", () => {
  it("reports static pointer cursors on inert native elements", () => {
    const result = runRule(
      noInertPointerAffordance,
      `const Cards = () => <><div className="cursor-pointer rounded-lg">Card</div><span className={'cursor-pointer'}>More</span><article className={\`cursor-pointer\`}>Story</article></>;`,
    );
    expect(result.diagnostics).toHaveLength(3);
  });

  it("allows pointer and drag handlers on the element", () => {
    const result = runRule(
      noInertPointerAffordance,
      `const Controls = () => <><div className="cursor-pointer" onClick={open} /><div className="cursor-pointer" onPointerDown={resize} /><div className="cursor-pointer" onMouseEnter={preview} /><div className="cursor-pointer" onTouchStart={drag} /><div className="cursor-pointer" onDragStart={drag} /></>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("allows delegated interaction signals on wrapping elements", () => {
    const result = runRule(
      noInertPointerAffordance,
      `const Rows = () => <><div onClick={select}><section><span className="cursor-pointer">Select</span></section></div><div onPointerUp={select}><span className="cursor-pointer">Select</span></div><div onTouchEnd={select}><span className="cursor-pointer">Select</span></div><div onClick={select} children={<span className="cursor-pointer">Select</span>} /></>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("allows explicit interaction semantics on the element or an ancestor", () => {
    const result = runRule(
      noInertPointerAffordance,
      `const Controls = () => <><div role="button" className="cursor-pointer" /><div role={role} className="cursor-pointer" /><div tabIndex={0} className="cursor-pointer" /><div draggable className="cursor-pointer" /><div contentEditable className="cursor-pointer" /><div role="link"><span className="cursor-pointer">Open</span></div></>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("allows spreads because they can supply delegated behavior", () => {
    const result = runRule(
      noInertPointerAffordance,
      `const Rows = ({ props }) => <><div className="cursor-pointer" {...props} /><div {...props}><span className="cursor-pointer">Select</span></div></>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("allows refs because they can attach imperative behavior", () => {
    const result = runRule(
      noInertPointerAffordance,
      `const Control = () => <div ref={controlRef} className="cursor-pointer">Open</div>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("allows label semantics and wrapping native controls", () => {
    const result = runRule(
      noInertPointerAffordance,
      `const Controls = () => <><label className="cursor-pointer"><input type="checkbox" /> Agree</label><label><span className="cursor-pointer">Upload</span><input type="file" /></label><button><span className="cursor-pointer">Save</span></button><a href="/settings"><span className="cursor-pointer">Settings</span></a></>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("allows nested controls and delegated interaction targets", () => {
    const result = runRule(
      noInertPointerAffordance,
      `const Controls = () => <>
        <div className="cursor-pointer"><button>Open</button></div>
        <ul className="cursor-pointer"><li onClick={select}>Select</li></ul>
        <section className="cursor-pointer"><svg {...trigger} /></section>
        <div className="cursor-pointer"><OverlayTrigger /></div>
        <div className="cursor-pointer">{open && <button>Close</button>}</div>
        <div className="cursor-pointer">{items.map((item) => <span onClick={() => select(item)}>{item}</span>)}</div>
      </>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still reports noninteractive roles and anchors without href", () => {
    const result = runRule(
      noInertPointerAffordance,
      `const Content = () => <><div role="group" className="cursor-pointer">Group</div><a className="cursor-pointer">Missing destination</a></>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("skips custom elements, dynamic classes, and variant-only cursors", () => {
    const result = runRule(
      noInertPointerAffordance,
      `const Content = ({ className }) => <><Card className="cursor-pointer" /><div className={className} /><div className="hover:cursor-pointer" /><div className="cursor-default" /></>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("abstains when equal-priority cursor utilities conflict", () => {
    const result = runRule(
      noInertPointerAffordance,
      `const Content = () => <><div className="cursor-pointer cursor-default" /><div className="cursor-default cursor-pointer" /></>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("honors important cursor utilities independently of class order", () => {
    const result = runRule(
      noInertPointerAffordance,
      `const Content = () => <><div className="cursor-default !cursor-pointer" /><div className="!cursor-pointer cursor-default" /><div className="cursor-pointer cursor-default!" /><div className="cursor-default! cursor-pointer" /><div className="!cursor-default !cursor-pointer" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("abstains inside opaque component children and JSX value props", () => {
    const result = runRule(
      noInertPointerAffordance,
      `const Content = () => <>
        <Link href="/settings"><div className="cursor-pointer">Settings</div></Link>
        <Tooltip><span className="cursor-pointer">Details</span></Tooltip>
        <Picker customButton={<span className="cursor-pointer">Color</span>} />
      </>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
