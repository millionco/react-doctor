import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noStaticElementInteractions } from "./no-static-element-interactions.js";

describe("a11y/no-static-element-interactions regressions", () => {
  it("does not flag a string-literal role wrapped in a JSX expression container", () => {
    const result = runRule(
      noStaticElementInteractions,
      `export const A = ({ onClick }) => <div role={'link'} onClick={onClick} />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a wrapped string-literal role that is not interactive", () => {
    const result = runRule(
      noStaticElementInteractions,
      `export const A = ({ onClick }) => <div role={'wat'} onClick={onClick} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag an svg with a click handler", () => {
    const result = runRule(
      noStaticElementInteractions,
      `export const A = ({ onClick }) => <svg width="10" height="10" onClick={onClick} />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a div with a click handler and no role", () => {
    const result = runRule(
      noStaticElementInteractions,
      `export const A = ({ onClick }) => <div onClick={onClick} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag the Marigold wrapper with an equivalent accessible edit Button", () => {
    const result = runRule(
      noStaticElementInteractions,
      `import { Button } from "react-aria-components";
      export const EditableCell = ({ disabled, setOpen, children }) => (
        <div onClick={disabled ? undefined : () => setOpen(true)}>
          <span>{children}</span>
          {!disabled && (
            <div>
              <Button aria-label="Edit" onPress={() => setOpen(true)}>Edit</Button>
            </div>
          )}
        </div>
      );`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it.each(["const noAction = null;", "const emptyAction = null; const noAction = emptyAction;"])(
    "does not flag an equivalent action behind a nullish const alias",
    (aliasDeclaration) => {
      const result = runRule(
        noStaticElementInteractions,
        `const Card = ({ disabled, open }) => {
        ${aliasDeclaration}
        return (
          <div onClick={disabled ? noAction : () => open()}>
            <Button aria-label="Open" onPress={() => open()}>Open</Button>
          </div>
        );
      };`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    },
  );

  it("still flags a conditional action whose nullish-looking alias is mutable", () => {
    const result = runRule(
      noStaticElementInteractions,
      `const Card = ({ disabled, open, replaceAction }) => {
        let noAction = null;
        noAction = replaceAction;
        return (
          <div onClick={disabled ? noAction : () => open()}>
            <Button aria-label="Open" onPress={() => open()}>Open</Button>
          </div>
        );
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a wrapper whose accessible descendant performs a different action", () => {
    const result = runRule(
      noStaticElementInteractions,
      `export const Card = ({ openCard, deleteCard }) => (
        <div onClick={() => openCard()}>
          <Button aria-label="Delete" onPress={() => deleteCard()}>Delete</Button>
        </div>
      );`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still distinguishes sibling callbacks destructured from the same object", () => {
    const result = runRule(
      noStaticElementInteractions,
      `export const Popconfirm = (props) => {
        const { onPopupClick, onCancel, showCancel } = props;
        return (
          <div onClick={onPopupClick}>
            {showCancel && <Button onClick={onCancel}>Cancel</Button>}
          </div>
        );
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a wrapper around a similarly named userland navigation component", () => {
    const result = runRule(
      noStaticElementInteractions,
      `export const Card = ({ openCard, showNavigation }) => (
        <div onClick={() => openCard()}>
          {showNavigation && (
            <NavigationCard aria-label="Open" onClick={() => openCard()} />
          )}
        </div>
      );`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a wrapper whose equivalent descendant has no accessible name", () => {
    const result = runRule(
      noStaticElementInteractions,
      `export const Card = ({ openCard }) => (
        <div onClick={() => openCard()}>
          <Button aria-label="" onPress={() => openCard()}>{null}</Button>
        </div>
      );`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag an equivalent descendant named by nested visible text", () => {
    const result = runRule(
      noStaticElementInteractions,
      `export const Card = ({ openCard }) => (
        <div onClick={() => openCard()}>
          <Button onPress={() => openCard()}><span>Open</span></Button>
        </div>
      );`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a class method propagation shield", () => {
    const result = runRule(
      noStaticElementInteractions,
      `class Modal extends React.Component {
        handleBoxClick(event) { event.stopPropagation(); }
        render() { return <div onClick={this.handleBoxClick}>{this.props.children}</div>; }
      }`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a class method that performs an action after blocking propagation", () => {
    const result = runRule(
      noStaticElementInteractions,
      `class Modal extends React.Component {
        handleBoxClick(event) { event.stopPropagation(); this.props.openModal(); }
        render() { return <div onClick={this.handleBoxClick}>{this.props.children}</div>; }
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a conditional role where both branches are valid roles", () => {
    const result = runRule(
      noStaticElementInteractions,
      `export const Option = ({ menu, onClick, onKeyDown }) => (
        <div role={menu ? 'menuitemcheckbox' : 'option'} tabIndex={0} onClick={onClick} onKeyDown={onKeyDown} />
      );`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a role present exactly when the element is clickable", () => {
    const result = runRule(
      noStaticElementInteractions,
      `export const Row = ({ isClickable, onClick }) => (
        <div role={isClickable ? 'button' : undefined} tabIndex={isClickable ? 0 : undefined} onClick={onClick} />
      );`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a role computed at runtime", () => {
    const result = runRule(
      noStaticElementInteractions,
      `export const A = ({ computedRole, onClick }) => <div role={computedRole} onClick={onClick} />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags role={undefined}", () => {
    const result = runRule(
      noStaticElementInteractions,
      `export const A = ({ onClick }) => <div role={undefined} onClick={onClick} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a conditional role where no branch is a recognized role", () => {
    const result = runRule(
      noStaticElementInteractions,
      `export const A = ({ wat, onClick }) => <div role={wat ? 'wat' : undefined} onClick={onClick} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a keyboard-delegation wrapper that can't take focus", () => {
    const result = runRule(
      noStaticElementInteractions,
      `export const Palette = ({ handleKeyDown, children }) => (
        <div onKeyDown={handleKeyDown}>{children}</div>
      );`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a focusable div with only a keyboard handler", () => {
    const result = runRule(
      noStaticElementInteractions,
      `export const A = ({ onKeyDown }) => <div tabIndex={0} onKeyDown={onKeyDown} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a programmatically focusable editor with only a keyboard handler", () => {
    const result = runRule(
      noStaticElementInteractions,
      `export const Editor = ({ onKeyDown }) => <div tabIndex={-1} onKeyDown={onKeyDown} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a contentEditable div with only a keyboard handler", () => {
    const result = runRule(
      noStaticElementInteractions,
      `export const Title = ({ onKeyDown }) => <div contentEditable onKeyDown={onKeyDown} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a mouse-only drag grip", () => {
    const result = runRule(
      noStaticElementInteractions,
      `export const Grip = ({ onMouseDown }) => <span onMouseDown={onMouseDown} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a wrapper whose sibling mouse handler performs a different action", () => {
    const result = runRule(
      noStaticElementInteractions,
      `export const Card = ({ open, reorder }) => (
        <div onClick={() => open()} onMouseDown={() => reorder()}>
          <button aria-label="Open" onClick={() => open()}>Open</button>
        </div>
      );`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a wrapper whose only sibling handler is a pure event blocker", () => {
    const result = runRule(
      noStaticElementInteractions,
      `export const Card = ({ open }) => (
        <div onClick={() => open()} onMouseDown={(event) => event.stopPropagation()}>
          <Button aria-label="Open" onPress={() => open()}>Open</Button>
        </div>
      );`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a wrapper whose equivalent Button sits inside an aria-hidden subtree", () => {
    const result = runRule(
      noStaticElementInteractions,
      `export const Card = ({ open }) => (
        <div onClick={() => open()}>
          <div aria-hidden="true">
            <Button aria-label="Open" onPress={() => open()}>Open</Button>
          </div>
        </div>
      );`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a wrapper whose equivalent Button opts out of the tab order", () => {
    const result = runRule(
      noStaticElementInteractions,
      `export const Card = ({ open }) => (
        <div onClick={() => open()}>
          <Button tabIndex={-1} aria-label="Open" onPress={() => open()}>Open</Button>
        </div>
      );`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a wrapper whose equivalent Button sets a non-negative tabIndex", () => {
    const result = runRule(
      noStaticElementInteractions,
      `export const Card = ({ open }) => (
        <div onClick={() => open()}>
          <Button tabIndex={0} aria-label="Open" onPress={() => open()}>Open</Button>
        </div>
      );`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a wrapper whose click handler statically resolves to null", () => {
    const result = runRule(
      noStaticElementInteractions,
      `const noop = null;
      export const Card = () => (
        <div onClick={noop}>
          <button aria-label="Open" onClick={noop}>Open</button>
        </div>
      );`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a wrapper sharing a const-aliased handler with its Button", () => {
    const result = runRule(
      noStaticElementInteractions,
      `export const Card = ({ setOpen }) => {
        const openEditor = () => setOpen(true);
        return (
          <div onClick={openEditor}>
            <Button aria-label="Edit" onPress={openEditor}>Edit</Button>
          </div>
        );
      };`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it.each(["disabled", "isDisabled"])(
    "still flags a wrapper whose equivalent Button is %s",
    (disabledPropName) => {
      const result = runRule(
        noStaticElementInteractions,
        `export const Card = ({ open }) => (
          <div onClick={() => open()}>
            <Button ${disabledPropName} aria-label="Open" onPress={() => open()}>Open</Button>
          </div>
        );`,
      );
      expect(result.diagnostics).toHaveLength(1);
    },
  );

  it.each(['aria-disabled="true"', "aria-disabled={true}", "aria-disabled={isDisabled}"])(
    "still flags a wrapper whose equivalent Button sets %s",
    (disabledAttribute) => {
      const result = runRule(
        noStaticElementInteractions,
        `const Card = ({ open, isDisabled }) => (
          <div onClick={() => open()}>
            <Button ${disabledAttribute} aria-label="Open" onPress={() => open()}>Open</Button>
          </div>
        );`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    },
  );

  it("does not flag a wrapper whose equivalent Button is statically aria-enabled", () => {
    const result = runRule(
      noStaticElementInteractions,
      `const Card = ({ open }) => (
        <div onClick={() => open()}>
          <Button aria-disabled={false} aria-label="Open" onPress={() => open()}>Open</Button>
        </div>
      );`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a wrapper whose same-action descendant is a lowercase custom element", () => {
    const result = runRule(
      noStaticElementInteractions,
      `const Card = ({ open }) => (
        <div onClick={() => open()}>
          <app-button aria-label="Open" onClick={() => open()}>Open</app-button>
        </div>
      );`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a wrapper whose equivalent anchor lacks an href", () => {
    const result = runRule(
      noStaticElementInteractions,
      `export const Card = ({ open }) => (
        <div onClick={() => open()}>
          <a role="button" onClick={() => open()}>Open</a>
        </div>
      );`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a wrapper whose equivalent Button renders inside fragments", () => {
    const result = runRule(
      noStaticElementInteractions,
      `export const Card = ({ open }) => (
        <div onClick={() => open()}>
          <>
            <Button onPress={() => open()}><>Open</></Button>
          </>
        </div>
      );`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a wrapper whose equivalent Button is hidden from screen readers", () => {
    const result = runRule(
      noStaticElementInteractions,
      `export const Card = ({ open }) => (
        <div onClick={() => open()}>
          <Button aria-hidden="true" aria-label="Open" onPress={() => open()}>Open</Button>
        </div>
      );`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a wrapper whose equivalent Button is named by aria-labelledby", () => {
    const result = runRule(
      noStaticElementInteractions,
      `export const Card = ({ open }) => (
        <div onClick={() => open()}>
          <Button aria-labelledby="open-label" onPress={() => open()} />
        </div>
      );`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a wrapper when both block-bodied handlers perform the same action", () => {
    const result = runRule(
      noStaticElementInteractions,
      `export const Card = ({ open }) => (
        <div onClick={() => { open(); }}>
          <Button aria-label="Open" onPress={() => { return open(); }}>Open</Button>
        </div>
      );`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag an object-method propagation shield", () => {
    const result = runRule(
      noStaticElementInteractions,
      `const cardHandlers = { shield(event) { event.stopPropagation(); } };
      export const Card = ({ children }) => (
        <div onClick={cardHandlers.shield}>{children}</div>
      );`,
    );
    expect(result.diagnostics).toEqual([]);
  });
});
