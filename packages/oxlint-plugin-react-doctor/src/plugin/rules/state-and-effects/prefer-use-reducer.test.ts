import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { preferUseReducer } from "./prefer-use-reducer.js";

describe("prefer-useReducer", () => {
  describe("valid — independent state stays quiet", () => {
    it("does not flag many useState values updated through independent branch-local handlers (ink TUI regression)", () => {
      const code = `
import { useMemo, useState } from "react";
export const ProjectSelect = ({ packages, onSubmit }) => {
  const [mode, setMode] = useState("list");
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [offset, setOffset] = useState(0);
  const [checked, setChecked] = useState(() => new Set());

  const setFilter = (next) => {
    setQuery(next);
    setSelectedIndex(0);
    setOffset(0);
  };

  const move = (delta) => {
    setSelectedIndex(selectedIndex + delta);
    setOffset((current) => current + delta);
  };

  useInput((input, key) => {
    if (input === "/") return setMode("search");
    if (input === " ") {
      setChecked((current) => new Set(current));
      return;
    }
    if (key.escape) {
      if (query.length > 0) return setFilter("");
      return onSubmit([]);
    }
    if (key.downArrow) return move(1);
    if (key.upArrow) return move(-1);
  });

  return null;
};
`;
      const result = runRule(preferUseReducer, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("does not flag five useState values with per-input change handlers", () => {
      const code = `
import { useState } from "react";
const Form = () => {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [age, setAge] = useState(0);
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  return (
    <div>
      <input value={name} onChange={(event) => setName(event.target.value)} />
      <input value={email} onChange={(event) => setEmail(event.target.value)} />
      <input value={age} onChange={(event) => setAge(Number(event.target.value))} />
      <input value={address} onChange={(event) => setAddress(event.target.value)} />
      <input value={phone} onChange={(event) => setPhone(event.target.value)} />
    </div>
  );
};
`;
      const result = runRule(preferUseReducer, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("does not flag setters that only co-update in groups below the threshold", () => {
      const code = `
import { useState } from "react";
const Wizard = () => {
  const [step, setStep] = useState(0);
  const [answer, setAnswer] = useState("");
  const [errorText, setErrorText] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [result, setResult] = useState(null);
  const advance = () => {
    setStep(step + 1);
    setAnswer("");
    setErrorText("");
  };
  const finish = (payload) => {
    setIsBusy(false);
    setResult(payload);
  };
  return advance ?? finish;
};
`;
      const result = runRule(preferUseReducer, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("does not flag setters spread across different if branches of one handler", () => {
      const code = `
import { useState } from "react";
const KeyRouter = () => {
  const [a, setA] = useState(0);
  const [b, setB] = useState(0);
  const [c, setC] = useState(0);
  const [d, setD] = useState(0);
  const [e, setE] = useState(0);
  const onKey = (key) => {
    if (key === "a") {
      setA(1);
    } else if (key === "b") {
      setB(1);
    } else if (key === "c") {
      setC(1);
    } else if (key === "d") {
      setD(1);
    } else {
      setE(1);
    }
  };
  return onKey;
};
`;
      const result = runRule(preferUseReducer, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(0);
    });
  });

  describe("invalid — state that updates together stays reported", () => {
    it("flags five setters called together in one handler", () => {
      const code = `
import { useState } from "react";
const Profile = () => {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [age, setAge] = useState(0);
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const applyProfile = (profile) => {
    setName(profile.name);
    setEmail(profile.email);
    setAge(profile.age);
    setAddress(profile.address);
    setPhone(profile.phone);
  };
  return applyProfile;
};
`;
      const result = runRule(preferUseReducer, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].message).toContain("5 separate useState values");
      expect(result.diagnostics[0].message).toContain("Profile");
    });

    it("flags five setters called together inside an effect", () => {
      const code = `
import { useEffect, useState } from "react";
const Dashboard = ({ snapshot }) => {
  const [alpha, setAlpha] = useState(0);
  const [beta, setBeta] = useState(0);
  const [gamma, setGamma] = useState(0);
  const [delta, setDelta] = useState(0);
  const [epsilon, setEpsilon] = useState(0);
  useEffect(() => {
    setAlpha(snapshot.alpha);
    setBeta(snapshot.beta);
    setGamma(snapshot.gamma);
    setDelta(snapshot.delta);
    setEpsilon(snapshot.epsilon);
  }, [snapshot]);
  return null;
};
`;
      const result = runRule(preferUseReducer, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("flags co-updated setters written as return statements", () => {
      const code = `
import { useState } from "react";
const Panel = () => {
  const [a, setA] = useState(0);
  const [b, setB] = useState(0);
  const [c, setC] = useState(0);
  const [d, setD] = useState(0);
  const [e, setE] = useState(0);
  const apply = (snapshot) => {
    setA(snapshot.a);
    setB(snapshot.b);
    setC(snapshot.c);
    setD(snapshot.d);
    return setE(snapshot.e);
  };
  return apply;
};
`;
      const result = runRule(preferUseReducer, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });
  });

  describe("regressions — corpus-mined FP classes (prod telemetry review 2026-07)", () => {
    // Mined FP class: dialog components whose ONLY co-update site is a
    // reset handler / close-dialog effect writing every state back to its
    // useState initial value (frontend-panel TagLibraryManagerDialog,
    // GlobalSearchDialog, PdfPreview, cloudscape reset-all button, …).
    // Resetting N independent states is not "state that changes together".
    it("does not flag a reset handler that writes every state back to its initial value", () => {
      const code = `
import { useCallback, useState } from "react";
const TagManagerDialog = () => {
  const [tags, setTags] = useState([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const resetDialogState = useCallback(() => {
    setTags([]);
    setTotal(0);
    setQuery("");
    setLoading(false);
    setBusyId(null);
  }, []);
  return resetDialogState;
};
`;
      const result = runRule(preferUseReducer, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("does not flag a close-dialog effect that resets every state to its initial value", () => {
      const code = `
import { useEffect, useState } from "react";
const GlobalSearchDialog = ({ open }) => {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState(null);
  const [tags, setTags] = useState([]);
  const [tagLoading, setTagLoading] = useState(false);
  useEffect(() => {
    if (!open) {
      setQuery("");
      setFilter("all");
      setCategoryFilter(null);
      setTags([]);
      setTagLoading(false);
      return;
    }
  }, [open]);
  return null;
};
`;
      const result = runRule(preferUseReducer, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(0);
    });

    // TP shape retained: a block mixing reset writes with data-carrying
    // writes is a real transition (cloudscape table Resizer VO+Space
    // click sets isPointerDown/isDragging back to false while latching
    // three other states to true).
    it("still flags a handler mixing reset writes with data-carrying writes", () => {
      const code = `
import { useState } from "react";
const Resizer = () => {
  const [isPointerDown, setIsPointerDown] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [showUapButtons, setShowUapButtons] = useState(false);
  const [resizerHasFocus, setResizerHasFocus] = useState(false);
  const [isKeyboardDragging, setIsKeyboardDragging] = useState(false);
  const onClick = () => {
    setIsPointerDown(false);
    setIsDragging(false);
    setShowUapButtons(true);
    setResizerHasFocus(true);
    setIsKeyboardDragging(true);
  };
  return onClick;
};
`;
      const result = runRule(preferUseReducer, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });
  });
});
