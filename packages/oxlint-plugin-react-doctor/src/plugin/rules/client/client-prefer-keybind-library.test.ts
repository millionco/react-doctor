import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { clientPreferKeybindLibrary } from "./client-prefer-keybind-library.js";

describe("client-prefer-keybind-library", () => {
  describe("flags manual keyboard event listeners", () => {
    it("flags window.addEventListener('keydown', handler)", () => {
      const code = `
        const App = () => {
          useEffect(() => {
            const handler = (e) => {
              if (e.key === 'k' && e.metaKey) openSearch();
            };
            window.addEventListener('keydown', handler);
            return () => window.removeEventListener('keydown', handler);
          }, []);
          return <div />;
        };
      `;
      const result = runRule(clientPreferKeybindLibrary, code);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].message).toContain("react-hotkeys-hook");
      expect(result.diagnostics[0].message).toContain("keydown");
    });

    it("flags document.addEventListener('keydown', handler)", () => {
      const code = `
        const App = () => {
          useEffect(() => {
            document.addEventListener('keydown', handleKeyDown);
            return () => document.removeEventListener('keydown', handleKeyDown);
          }, []);
          return <div />;
        };
      `;
      const result = runRule(clientPreferKeybindLibrary, code);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].message).toContain("document");
    });

    it("flags window.addEventListener('keyup', handler)", () => {
      const code = `
        const App = () => {
          useEffect(() => {
            window.addEventListener('keyup', handler);
            return () => window.removeEventListener('keyup', handler);
          }, []);
          return <div />;
        };
      `;
      const result = runRule(clientPreferKeybindLibrary, code);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].message).toContain("keyup");
    });

    it("flags window.addEventListener('keypress', handler)", () => {
      const code = `
        const App = () => {
          useEffect(() => {
            window.addEventListener('keypress', handler);
            return () => window.removeEventListener('keypress', handler);
          }, []);
          return <div />;
        };
      `;
      const result = runRule(clientPreferKeybindLibrary, code);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].message).toContain("keypress");
    });

    it("flags global keydown listener outside useEffect", () => {
      const code = `
        window.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') closeModal();
        });
      `;
      const result = runRule(clientPreferKeybindLibrary, code);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("flags document keydown listener outside useEffect", () => {
      const code = `
        document.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') closeModal();
        });
      `;
      const result = runRule(clientPreferKeybindLibrary, code);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("flags keydown in useLayoutEffect", () => {
      const code = `
        const App = () => {
          useLayoutEffect(() => {
            window.addEventListener('keydown', handler);
            return () => window.removeEventListener('keydown', handler);
          }, []);
          return <div />;
        };
      `;
      const result = runRule(clientPreferKeybindLibrary, code);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("flags multiple keyboard listeners in the same effect", () => {
      const code = `
        const App = () => {
          useEffect(() => {
            window.addEventListener('keydown', onKeyDown);
            window.addEventListener('keyup', onKeyUp);
            return () => {
              window.removeEventListener('keydown', onKeyDown);
              window.removeEventListener('keyup', onKeyUp);
            };
          }, []);
          return <div />;
        };
      `;
      const result = runRule(clientPreferKeybindLibrary, code);
      expect(result.diagnostics).toHaveLength(2);
    });
  });

  describe("does not flag non-keyboard event listeners", () => {
    it("ignores window.addEventListener('click', handler)", () => {
      const code = `
        const App = () => {
          useEffect(() => {
            window.addEventListener('click', handler);
            return () => window.removeEventListener('click', handler);
          }, []);
          return <div />;
        };
      `;
      const result = runRule(clientPreferKeybindLibrary, code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("ignores window.addEventListener('scroll', handler)", () => {
      const code = `
        const App = () => {
          useEffect(() => {
            window.addEventListener('scroll', handler);
            return () => window.removeEventListener('scroll', handler);
          }, []);
          return <div />;
        };
      `;
      const result = runRule(clientPreferKeybindLibrary, code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("ignores window.addEventListener('resize', handler)", () => {
      const code = `
        const App = () => {
          useEffect(() => {
            window.addEventListener('resize', handler);
            return () => window.removeEventListener('resize', handler);
          }, []);
          return <div />;
        };
      `;
      const result = runRule(clientPreferKeybindLibrary, code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("ignores addEventListener('mousedown', handler)", () => {
      const code = `
        const App = () => {
          useEffect(() => {
            document.addEventListener('mousedown', handler);
            return () => document.removeEventListener('mousedown', handler);
          }, []);
          return <div />;
        };
      `;
      const result = runRule(clientPreferKeybindLibrary, code);
      expect(result.diagnostics).toHaveLength(0);
    });
  });

  describe("does not flag when a keybind library is already imported", () => {
    it("skips when react-hotkeys-hook is imported", () => {
      const code = `
        import { useHotkeys } from 'react-hotkeys-hook';
        const App = () => {
          useEffect(() => {
            window.addEventListener('keydown', handler);
            return () => window.removeEventListener('keydown', handler);
          }, []);
          return <div />;
        };
      `;
      const result = runRule(clientPreferKeybindLibrary, code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("skips when tinykeys is imported", () => {
      const code = `
        import tinykeys from 'tinykeys';
        const App = () => {
          useEffect(() => {
            document.addEventListener('keydown', handler);
            return () => document.removeEventListener('keydown', handler);
          }, []);
          return <div />;
        };
      `;
      const result = runRule(clientPreferKeybindLibrary, code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("skips when hotkeys-js is imported", () => {
      const code = `
        import hotkeys from 'hotkeys-js';
        const App = () => {
          useEffect(() => {
            window.addEventListener('keydown', handler);
            return () => window.removeEventListener('keydown', handler);
          }, []);
          return <div />;
        };
      `;
      const result = runRule(clientPreferKeybindLibrary, code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("skips when mousetrap is imported", () => {
      const code = `
        import Mousetrap from 'mousetrap';
        const App = () => {
          useEffect(() => {
            window.addEventListener('keydown', handler);
            return () => window.removeEventListener('keydown', handler);
          }, []);
          return <div />;
        };
      `;
      const result = runRule(clientPreferKeybindLibrary, code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("skips when react-hotkeys is imported", () => {
      const code = `
        import { HotKeys } from 'react-hotkeys';
        const App = () => {
          useEffect(() => {
            window.addEventListener('keydown', handler);
            return () => window.removeEventListener('keydown', handler);
          }, []);
          return <div />;
        };
      `;
      const result = runRule(clientPreferKeybindLibrary, code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("skips when @mantine/hooks is imported", () => {
      const code = `
        import { useHotkeys } from '@mantine/hooks';
        const App = () => {
          useEffect(() => {
            window.addEventListener('keydown', handler);
            return () => window.removeEventListener('keydown', handler);
          }, []);
          return <div />;
        };
      `;
      const result = runRule(clientPreferKeybindLibrary, code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("skips subpath imports from a keybind library", () => {
      const code = `
        import { useHotkeys } from 'react-hotkeys-hook/dist/index';
        const App = () => {
          useEffect(() => {
            window.addEventListener('keydown', handler);
            return () => window.removeEventListener('keydown', handler);
          }, []);
          return <div />;
        };
      `;
      const result = runRule(clientPreferKeybindLibrary, code);
      expect(result.diagnostics).toHaveLength(0);
    });
  });

  describe("does not flag element-scoped listeners (non-global, non-effect)", () => {
    it("ignores ref.current.addEventListener('keydown', handler) outside useEffect", () => {
      const code = `
        const handler = (e) => { console.log(e.key); };
        inputRef.current.addEventListener('keydown', handler);
      `;
      const result = runRule(clientPreferKeybindLibrary, code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("ignores element.addEventListener('keydown', handler) in non-effect function", () => {
      const code = `
        const setupKeybinds = (element) => {
          element.addEventListener('keydown', handler);
        };
      `;
      const result = runRule(clientPreferKeybindLibrary, code);
      expect(result.diagnostics).toHaveLength(0);
    });
  });

  describe("flags element-scoped listeners inside useEffect", () => {
    it("flags ref.current.addEventListener('keydown', handler) inside useEffect", () => {
      const code = `
        const App = () => {
          const inputRef = useRef(null);
          useEffect(() => {
            inputRef.current.addEventListener('keydown', handler);
            return () => inputRef.current.removeEventListener('keydown', handler);
          }, []);
          return <input ref={inputRef} />;
        };
      `;
      const result = runRule(clientPreferKeybindLibrary, code);
      expect(result.diagnostics).toHaveLength(1);
    });
  });

  describe("does not flag unrelated patterns", () => {
    it("ignores addEventListener with dynamic event name", () => {
      const code = `
        const App = () => {
          useEffect(() => {
            window.addEventListener(eventName, handler);
            return () => window.removeEventListener(eventName, handler);
          }, [eventName]);
          return <div />;
        };
      `;
      const result = runRule(clientPreferKeybindLibrary, code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("ignores addEventListener with template literal event name", () => {
      const code = `
        const App = () => {
          useEffect(() => {
            window.addEventListener(\`key\${type}\`, handler);
          }, []);
          return <div />;
        };
      `;
      const result = runRule(clientPreferKeybindLibrary, code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("ignores non-addEventListener member calls with 'keydown'", () => {
      const code = `
        const App = () => {
          useEffect(() => {
            emitter.on('keydown', handler);
          }, []);
          return <div />;
        };
      `;
      const result = runRule(clientPreferKeybindLibrary, code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("ignores addEventListener with fewer than 2 arguments", () => {
      const code = `
        window.addEventListener('keydown');
      `;
      const result = runRule(clientPreferKeybindLibrary, code);
      expect(result.diagnostics).toHaveLength(0);
    });
  });

  describe("open-source repo patterns", () => {
    it("flags VS Code-style Ctrl+Shift+P command palette shortcut", () => {
      const code = `
        const CommandPalette = () => {
          const [isOpen, setIsOpen] = useState(false);
          useEffect(() => {
            const handleKeyDown = (event) => {
              if (event.ctrlKey && event.shiftKey && event.key === 'p') {
                event.preventDefault();
                setIsOpen(true);
              }
            };
            window.addEventListener('keydown', handleKeyDown);
            return () => window.removeEventListener('keydown', handleKeyDown);
          }, []);
          return isOpen ? <Palette /> : null;
        };
      `;
      const result = runRule(clientPreferKeybindLibrary, code);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("flags Cmd+K search shortcut pattern", () => {
      const code = `
        const SearchBar = () => {
          useEffect(() => {
            const onKeyDown = (e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault();
                openSearch();
              }
            };
            document.addEventListener('keydown', onKeyDown);
            return () => document.removeEventListener('keydown', onKeyDown);
          }, []);
          return <input />;
        };
      `;
      const result = runRule(clientPreferKeybindLibrary, code);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("flags Escape-to-close modal pattern", () => {
      const code = `
        const Modal = ({ onClose }) => {
          useEffect(() => {
            const handleEscape = (e) => {
              if (e.key === 'Escape') onClose();
            };
            document.addEventListener('keydown', handleEscape);
            return () => document.removeEventListener('keydown', handleEscape);
          }, [onClose]);
          return <div className="modal">Content</div>;
        };
      `;
      const result = runRule(clientPreferKeybindLibrary, code);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("flags arrow-key navigation pattern", () => {
      const code = `
        const List = ({ items }) => {
          const [selectedIndex, setSelectedIndex] = useState(0);
          useEffect(() => {
            const handleArrowKeys = (e) => {
              if (e.key === 'ArrowDown') setSelectedIndex(i => Math.min(i + 1, items.length - 1));
              if (e.key === 'ArrowUp') setSelectedIndex(i => Math.max(i - 1, 0));
            };
            window.addEventListener('keydown', handleArrowKeys);
            return () => window.removeEventListener('keydown', handleArrowKeys);
          }, [items.length]);
          return <ul>{items.map((item, i) => <li key={i} className={i === selectedIndex ? 'selected' : ''}>{item}</li>)}</ul>;
        };
      `;
      const result = runRule(clientPreferKeybindLibrary, code);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("flags multi-key shortcut table pattern", () => {
      const code = `
        const App = () => {
          useEffect(() => {
            const shortcuts = {
              'ctrl+s': save,
              'ctrl+z': undo,
              'ctrl+y': redo,
            };
            const handler = (e) => {
              const key = [e.ctrlKey && 'ctrl', e.key].filter(Boolean).join('+');
              if (shortcuts[key]) {
                e.preventDefault();
                shortcuts[key]();
              }
            };
            window.addEventListener('keydown', handler);
            return () => window.removeEventListener('keydown', handler);
          }, []);
          return <Editor />;
        };
      `;
      const result = runRule(clientPreferKeybindLibrary, code);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("flags focus-trap keyboard handler pattern", () => {
      const code = `
        const Dialog = ({ children }) => {
          const dialogRef = useRef(null);
          useEffect(() => {
            const trapFocus = (e) => {
              if (e.key === 'Tab') {
                const focusable = dialogRef.current.querySelectorAll('button, input');
                if (e.shiftKey && document.activeElement === focusable[0]) {
                  e.preventDefault();
                  focusable[focusable.length - 1].focus();
                }
              }
            };
            document.addEventListener('keydown', trapFocus);
            return () => document.removeEventListener('keydown', trapFocus);
          }, []);
          return <div ref={dialogRef}>{children}</div>;
        };
      `;
      const result = runRule(clientPreferKeybindLibrary, code);
      expect(result.diagnostics).toHaveLength(1);
    });
  });

  describe("test file skipping (test-noise tag)", () => {
    it("does not flag in test files", () => {
      const code = `
        const App = () => {
          useEffect(() => {
            window.addEventListener('keydown', handler);
            return () => window.removeEventListener('keydown', handler);
          }, []);
          return <div />;
        };
      `;
      const result = runRule(clientPreferKeybindLibrary, code, {
        filename: "App.test.tsx",
      });
      expect(result.diagnostics).toHaveLength(0);
    });

    it("does not flag in spec files", () => {
      const code = `
        window.addEventListener('keydown', handler);
      `;
      const result = runRule(clientPreferKeybindLibrary, code, {
        filename: "keyboard.spec.ts",
      });
      expect(result.diagnostics).toHaveLength(0);
    });

    it("does not flag in story files", () => {
      const code = `
        window.addEventListener('keydown', handler);
      `;
      const result = runRule(clientPreferKeybindLibrary, code, {
        filename: "Modal.stories.tsx",
      });
      expect(result.diagnostics).toHaveLength(0);
    });
  });
});
