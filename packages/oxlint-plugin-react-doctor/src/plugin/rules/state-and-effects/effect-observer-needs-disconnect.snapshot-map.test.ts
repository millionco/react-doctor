import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { effectObserverNeedsDisconnect } from "./effect-observer-needs-disconnect.js";

interface ObserverSnapshotCase {
  name: string;
  code: string;
  expected: number;
}

const cases: ObserverSnapshotCase[] = [
  {
    name: "releases each original target through its mapped observer",
    code: 'import { useEffect } from "react";\nconst Panel = () => {\n  useEffect(() => {\n    const targets = Array.from(document.querySelectorAll(".item"));\n    const observers = targets.map((target) => {\n      const observer = new IntersectionObserver(() => {}, { threshold: 0.2 });\n      observer.observe(target);\n      return observer;\n    });\n    return () => {\n      targets.map((target, index) => observers[index]?.unobserve(target));\n    };\n  }, []);\n  return null;\n};',
    expected: 0,
  },
  {
    name: "supports an anonymous function acquisition callback",
    code: 'import { useEffect } from "react";\nconst Panel = () => {\n  useEffect(() => {\n    const targets = Array.from(document.querySelectorAll(".item"));\n    const observers = targets.map(function (target) {\n      const observer = new IntersectionObserver(() => {}, { threshold: 0.2 });\n      observer.observe(target);\n      return observer;\n    });\n    return () => {\n      targets.map((target, index) => observers[index]?.unobserve(target));\n    };\n  }, []);\n  return null;\n};',
    expected: 0,
  },
  {
    name: "supports a direct release member",
    code: 'import { useEffect } from "react";\nconst Panel = () => {\n  useEffect(() => {\n    const targets = Array.from(document.querySelectorAll(".item"));\n    const observers = targets.map((target) => {\n      const observer = new IntersectionObserver(() => {}, { threshold: 0.2 });\n      observer.observe(target);\n      return observer;\n    });\n    return () => {\n      targets.map((target, index) => observers[index].unobserve(target));\n    };\n  }, []);\n  return null;\n};',
    expected: 0,
  },
  {
    name: "supports a single statement cleanup callback",
    code: 'import { useEffect } from "react";\nconst Panel = () => {\n  useEffect(() => {\n    const targets = Array.from(document.querySelectorAll(".item"));\n    const observers = targets.map((target) => {\n      const observer = new IntersectionObserver(() => {}, { threshold: 0.2 });\n      observer.observe(target);\n      return observer;\n    });\n    return () => {\n      targets.map((target, index) => { observers[index]?.unobserve(target); });\n    };\n  }, []);\n  return null;\n};',
    expected: 0,
  },
  {
    name: "supports a renamed canonical effect import",
    code: 'import { useEffect as runEffect } from "react";\nconst Panel = () => {\n  runEffect(() => {\n    const targets = Array.from(document.querySelectorAll(".item"));\n    const observers = targets.map((target) => {\n      const observer = new IntersectionObserver(() => {}, { threshold: 0.2 });\n      observer.observe(target);\n      return observer;\n    });\n    return () => {\n      targets.map((target, index) => observers[index]?.unobserve(target));\n    };\n  }, []);\n  return null;\n};',
    expected: 0,
  },
  {
    name: "supports extra direct native queries within the observer callback",
    code: 'import { useEffect } from "react";\nconst Panel = () => {\n  useEffect(() => {\n    const targets = Array.from(document.querySelectorAll(".item"));\n    const observers = targets.map((target) => {\n      const observer = new IntersectionObserver(() => { Array.from(document.querySelectorAll(`.link-${label}`)).at(-1); }, { threshold: 0.2 });\n      observer.observe(target);\n      return observer;\n    });\n    return () => {\n      targets.map((target, index) => observers[index]?.unobserve(target));\n    };\n  }, []);\n  return null;\n};',
    expected: 0,
  },
  {
    name: "retains a shifted release index",
    code: 'import { useEffect } from "react";\nconst Panel = () => {\n  useEffect(() => {\n    const targets = Array.from(document.querySelectorAll(".item"));\n    const observers = targets.map((target) => {\n      const observer = new IntersectionObserver(() => {}, { threshold: 0.2 });\n      observer.observe(target);\n      return observer;\n    });\n    return () => {\n      targets.map((target, index) => observers[index + 1]?.unobserve(target));\n    };\n  }, []);\n  return null;\n};',
    expected: 1,
  },
  {
    name: "retains an unrelated release index",
    code: 'import { useEffect } from "react";\nconst Panel = () => {\n  useEffect(() => {\n    const targets = Array.from(document.querySelectorAll(".item"));\n    const observers = targets.map((target) => {\n      const observer = new IntersectionObserver(() => {}, { threshold: 0.2 });\n      observer.observe(target);\n      return observer;\n    });\n    return () => {\n      targets.map((target, index) => observers[selected]?.unobserve(target));\n    };\n  }, []);\n  return null;\n};',
    expected: 1,
  },
  {
    name: "retains a defaulted release index",
    code: 'import { useEffect } from "react";\nconst Panel = () => {\n  useEffect(() => {\n    const targets = Array.from(document.querySelectorAll(".item"));\n    const observers = targets.map((target) => {\n      const observer = new IntersectionObserver(() => {}, { threshold: 0.2 });\n      observer.observe(target);\n      return observer;\n    });\n    return () => {\n      targets.map((target, index = 0) => observers[index]?.unobserve(target));\n    };\n  }, []);\n  return null;\n};',
    expected: 1,
  },
  {
    name: "retains a changed release target",
    code: 'import { useEffect } from "react";\nconst Panel = () => {\n  useEffect(() => {\n    const targets = Array.from(document.querySelectorAll(".item"));\n    const observers = targets.map((target) => {\n      const observer = new IntersectionObserver(() => {}, { threshold: 0.2 });\n      observer.observe(target);\n      return observer;\n    });\n    return () => {\n      targets.map((target, index) => observers[index]?.unobserve(otherTarget));\n    };\n  }, []);\n  return null;\n};',
    expected: 1,
  },
  {
    name: "retains a re-queried cleanup collection",
    code: 'import { useEffect } from "react";\nconst Panel = () => {\n  useEffect(() => {\n    const targets = Array.from(document.querySelectorAll(".item"));\n    const observers = targets.map((target) => {\n      const observer = new IntersectionObserver(() => {}, { threshold: 0.2 });\n      observer.observe(target);\n      return observer;\n    });\n    return () => {\n      Array.from(document.querySelectorAll(".item")).map((target, index) => observers[index]?.unobserve(target));\n    };\n  }, []);\n  return null;\n};',
    expected: 1,
  },
  {
    name: "retains conditional cleanup",
    code: 'import { useEffect } from "react";\nconst Panel = () => {\n  useEffect(() => {\n    const targets = Array.from(document.querySelectorAll(".item"));\n    const observers = targets.map((target) => {\n      const observer = new IntersectionObserver(() => {}, { threshold: 0.2 });\n      observer.observe(target);\n      return observer;\n    });\n    return () => {\n      if (enabled) targets.map((target, index) => observers[index]?.unobserve(target));\n    };\n  }, []);\n  return null;\n};',
    expected: 1,
  },
  {
    name: "retains an observer array escape",
    code: 'import { useEffect } from "react";\nconst Panel = () => {\n  useEffect(() => {\n    const targets = Array.from(document.querySelectorAll(".item"));\n    const observers = targets.map((target) => {\n      const observer = new IntersectionObserver(() => {}, { threshold: 0.2 });\n      observer.observe(target);\n      return observer;\n    });\n    publish(observers);\n    return () => {\n      targets.map((target, index) => observers[index]?.unobserve(target));\n    };\n  }, []);\n  return null;\n};',
    expected: 1,
  },
  {
    name: "retains a snapshot escape",
    code: 'import { useEffect } from "react";\nconst Panel = () => {\n  useEffect(() => {\n    const targets = Array.from(document.querySelectorAll(".item"));\n    const observers = targets.map((target) => {\n      const observer = new IntersectionObserver(() => {}, { threshold: 0.2 });\n      observer.observe(target);\n      return observer;\n    });\n    publish(targets);\n    return () => {\n      targets.map((target, index) => observers[index]?.unobserve(target));\n    };\n  }, []);\n  return null;\n};',
    expected: 1,
  },
  {
    name: "retains an observer escape",
    code: 'import { useEffect } from "react";\nconst Panel = () => {\n  useEffect(() => {\n    const targets = Array.from(document.querySelectorAll(".item"));\n    const observers = targets.map((target) => {\n      const observer = new IntersectionObserver(() => {}, { threshold: 0.2 });\n      publish(observer);\n      observer.observe(target);\n      return observer;\n    });\n    return () => {\n      targets.map((target, index) => observers[index]?.unobserve(target));\n    };\n  }, []);\n  return null;\n};',
    expected: 1,
  },
  {
    name: "retains an additional observe target",
    code: 'import { useEffect } from "react";\nconst Panel = () => {\n  useEffect(() => {\n    const targets = Array.from(document.querySelectorAll(".item"));\n    const observers = targets.map((target) => {\n      const observer = new IntersectionObserver(() => {}, { threshold: 0.2 });\n      observer.observe(target);\n      observer.observe(otherTarget);\n      return observer;\n    });\n    return () => {\n      targets.map((target, index) => observers[index]?.unobserve(target));\n    };\n  }, []);\n  return null;\n};',
    expected: 1,
  },
  {
    name: "retains observer array mutation",
    code: 'import { useEffect } from "react";\nconst Panel = () => {\n  useEffect(() => {\n    const targets = Array.from(document.querySelectorAll(".item"));\n    const observers = targets.map((target) => {\n      const observer = new IntersectionObserver(() => {}, { threshold: 0.2 });\n      observer.observe(target);\n      return observer;\n    });\n    observers.reverse();\n    return () => {\n      targets.map((target, index) => observers[index]?.unobserve(target));\n    };\n  }, []);\n  return null;\n};',
    expected: 1,
  },
  {
    name: "retains snapshot mutation",
    code: 'import { useEffect } from "react";\nconst Panel = () => {\n  useEffect(() => {\n    const targets = Array.from(document.querySelectorAll(".item"));\n    const observers = targets.map((target) => {\n      const observer = new IntersectionObserver(() => {}, { threshold: 0.2 });\n      observer.observe(target);\n      return observer;\n    });\n    targets.reverse();\n    return () => {\n      targets.map((target, index) => observers[index]?.unobserve(target));\n    };\n  }, []);\n  return null;\n};',
    expected: 1,
  },
  {
    name: "retains a mutable snapshot binding",
    code: 'import { useEffect } from "react";\nconst Panel = () => {\n  useEffect(() => {\n    let targets = Array.from(document.querySelectorAll(".item"));\n    const observers = targets.map((target) => {\n      const observer = new IntersectionObserver(() => {}, { threshold: 0.2 });\n      observer.observe(target);\n      return observer;\n    });\n    return () => {\n      targets.map((target, index) => observers[index]?.unobserve(target));\n    };\n  }, []);\n  return null;\n};',
    expected: 1,
  },
  {
    name: "retains a mutable observer binding",
    code: 'import { useEffect } from "react";\nconst Panel = () => {\n  useEffect(() => {\n    const targets = Array.from(document.querySelectorAll(".item"));\n    const observers = targets.map((target) => {\n      let observer = new IntersectionObserver(() => {}, { threshold: 0.2 });\n      observer.observe(target);\n      return observer;\n    });\n    return () => {\n      targets.map((target, index) => observers[index]?.unobserve(target));\n    };\n  }, []);\n  return null;\n};',
    expected: 1,
  },
  {
    name: "retains a mutable observer collection",
    code: 'import { useEffect } from "react";\nconst Panel = () => {\n  useEffect(() => {\n    const targets = Array.from(document.querySelectorAll(".item"));\n    let observers = targets.map((target) => {\n      const observer = new IntersectionObserver(() => {}, { threshold: 0.2 });\n      observer.observe(target);\n      return observer;\n    });\n    return () => {\n      targets.map((target, index) => observers[index]?.unobserve(target));\n    };\n  }, []);\n  return null;\n};',
    expected: 1,
  },
  {
    name: "retains an observer alias",
    code: 'import { useEffect } from "react";\nconst Panel = () => {\n  useEffect(() => {\n    const targets = Array.from(document.querySelectorAll(".item"));\n    const observers = targets.map((target) => {\n      const observer = new IntersectionObserver(() => {}, { threshold: 0.2 });\n      observer.observe(target);\n      const alias = observer;\n      return alias;\n    });\n    return () => {\n      targets.map((target, index) => observers[index]?.unobserve(target));\n    };\n  }, []);\n  return null;\n};',
    expected: 1,
  },
  {
    name: "retains a cleanup target assignment",
    code: 'import { useEffect } from "react";\nconst Panel = () => {\n  useEffect(() => {\n    const targets = Array.from(document.querySelectorAll(".item"));\n    const observers = targets.map((target) => {\n      const observer = new IntersectionObserver(() => {}, { threshold: 0.2 });\n      observer.observe(target);\n      return observer;\n    });\n    return () => {\n      targets.map((target, index) => { target = otherTarget; observers[index]?.unobserve(target); });\n    };\n  }, []);\n  return null;\n};',
    expected: 1,
  },
  {
    name: "retains a cleanup index assignment",
    code: 'import { useEffect } from "react";\nconst Panel = () => {\n  useEffect(() => {\n    const targets = Array.from(document.querySelectorAll(".item"));\n    const observers = targets.map((target) => {\n      const observer = new IntersectionObserver(() => {}, { threshold: 0.2 });\n      observer.observe(target);\n      return observer;\n    });\n    return () => {\n      targets.map((target, index) => { index = 0; observers[index]?.unobserve(target); });\n    };\n  }, []);\n  return null;\n};',
    expected: 1,
  },
  {
    name: "retains an async mapping callback",
    code: 'import { useEffect } from "react";\nconst Panel = () => {\n  useEffect(() => {\n    const targets = Array.from(document.querySelectorAll(".item"));\n    const observers = targets.map(async (target) => {\n      const observer = new IntersectionObserver(() => {}, { threshold: 0.2 });\n      observer.observe(target);\n      return observer;\n    });\n    return () => {\n      targets.map((target, index) => observers[index]?.unobserve(target));\n    };\n  }, []);\n  return null;\n};',
    expected: 1,
  },
  {
    name: "retains a named mapping callback",
    code: 'import { useEffect } from "react";\nconst Panel = () => {\n  useEffect(() => {\n    const targets = Array.from(document.querySelectorAll(".item"));\n    const observers = targets.map(function named(target) {\n      const observer = new IntersectionObserver(() => {}, { threshold: 0.2 });\n      observer.observe(target);\n      return observer;\n    });\n    return () => {\n      targets.map((target, index) => observers[index]?.unobserve(target));\n    };\n  }, []);\n  return null;\n};',
    expected: 1,
  },
  {
    name: "retains callback this inputs",
    code: 'import { useEffect } from "react";\nconst Panel = () => {\n  useEffect(() => {\n    const targets = Array.from(document.querySelectorAll(".item"));\n    const observers = targets.map((target) => {\n      const observer = new IntersectionObserver(() => { inspect(this); }, { threshold: 0.2 });\n      observer.observe(target);\n      return observer;\n    });\n    return () => {\n      targets.map((target, index) => observers[index]?.unobserve(target));\n    };\n  }, []);\n  return null;\n};',
    expected: 1,
  },
  {
    name: "retains callback arguments inputs",
    code: 'import { useEffect } from "react";\nconst Panel = () => {\n  useEffect(() => {\n    const targets = Array.from(document.querySelectorAll(".item"));\n    const observers = targets.map((target) => {\n      const observer = new IntersectionObserver(function () { inspect(arguments); }, { threshold: 0.2 });\n      observer.observe(target);\n      return observer;\n    });\n    return () => {\n      targets.map((target, index) => observers[index]?.unobserve(target));\n    };\n  }, []);\n  return null;\n};',
    expected: 1,
  },
  {
    name: "retains a nonliteral acquisition selector",
    code: 'import { useEffect } from "react";\nconst Panel = () => {\n  useEffect(() => {\n    const targets = Array.from(document.querySelectorAll(selector));\n    const observers = targets.map((target) => {\n      const observer = new IntersectionObserver(() => {}, { threshold: 0.2 });\n      observer.observe(target);\n      return observer;\n    });\n    return () => {\n      targets.map((target, index) => observers[index]?.unobserve(target));\n    };\n  }, []);\n  return null;\n};',
    expected: 1,
  },
  {
    name: "retains a snapshot constructor alias",
    code: 'import { useEffect } from "react";\nconst makeArray = Array.from;\nconst Panel = () => {\n  useEffect(() => {\n    const targets = Array.from(document.querySelectorAll(".item"));\n    const observers = targets.map((target) => {\n      const observer = new IntersectionObserver(() => {}, { threshold: 0.2 });\n      observer.observe(target);\n      return observer;\n    });\n    return () => {\n      targets.map((target, index) => observers[index]?.unobserve(target));\n    };\n  }, []);\n  return null;\n};',
    expected: 1,
  },
  {
    name: "retains a document provider escape",
    code: 'import { useEffect } from "react";\ninstall(document);\nconst Panel = () => {\n  useEffect(() => {\n    const targets = Array.from(document.querySelectorAll(".item"));\n    const observers = targets.map((target) => {\n      const observer = new IntersectionObserver(() => {}, { threshold: 0.2 });\n      observer.observe(target);\n      return observer;\n    });\n    return () => {\n      targets.map((target, index) => observers[index]?.unobserve(target));\n    };\n  }, []);\n  return null;\n};',
    expected: 1,
  },
  {
    name: "retains a native constructor escape",
    code: 'import { useEffect } from "react";\ninstall(IntersectionObserver);\nconst Panel = () => {\n  useEffect(() => {\n    const targets = Array.from(document.querySelectorAll(".item"));\n    const observers = targets.map((target) => {\n      const observer = new IntersectionObserver(() => {}, { threshold: 0.2 });\n      observer.observe(target);\n      return observer;\n    });\n    return () => {\n      targets.map((target, index) => observers[index]?.unobserve(target));\n    };\n  }, []);\n  return null;\n};',
    expected: 1,
  },
  {
    name: "retains array prototype replacement",
    code: 'import { useEffect } from "react";\nArray.prototype.map = replacement;\nconst Panel = () => {\n  useEffect(() => {\n    const targets = Array.from(document.querySelectorAll(".item"));\n    const observers = targets.map((target) => {\n      const observer = new IntersectionObserver(() => {}, { threshold: 0.2 });\n      observer.observe(target);\n      return observer;\n    });\n    return () => {\n      targets.map((target, index) => observers[index]?.unobserve(target));\n    };\n  }, []);\n  return null;\n};',
    expected: 1,
  },
  {
    name: "retains a provider member pattern write",
    code: 'import { useEffect } from "react";\n({ value: document.querySelectorAll } = replacement);\nconst Panel = () => {\n  useEffect(() => {\n    const targets = Array.from(document.querySelectorAll(".item"));\n    const observers = targets.map((target) => {\n      const observer = new IntersectionObserver(() => {}, { threshold: 0.2 });\n      observer.observe(target);\n      return observer;\n    });\n    return () => {\n      targets.map((target, index) => observers[index]?.unobserve(target));\n    };\n  }, []);\n  return null;\n};',
    expected: 1,
  },
  {
    name: "retains a provider member loop write",
    code: 'import { useEffect } from "react";\nfor (document.querySelectorAll of replacements) {}\nconst Panel = () => {\n  useEffect(() => {\n    const targets = Array.from(document.querySelectorAll(".item"));\n    const observers = targets.map((target) => {\n      const observer = new IntersectionObserver(() => {}, { threshold: 0.2 });\n      observer.observe(target);\n      return observer;\n    });\n    return () => {\n      targets.map((target, index) => observers[index]?.unobserve(target));\n    };\n  }, []);\n  return null;\n};',
    expected: 1,
  },
  {
    name: "retains reflective native exposure",
    code: 'import { useEffect } from "react";\nReflect.get(provider, key);\nconst Panel = () => {\n  useEffect(() => {\n    const targets = Array.from(document.querySelectorAll(".item"));\n    const observers = targets.map((target) => {\n      const observer = new IntersectionObserver(() => {}, { threshold: 0.2 });\n      observer.observe(target);\n      return observer;\n    });\n    return () => {\n      targets.map((target, index) => observers[index]?.unobserve(target));\n    };\n  }, []);\n  return null;\n};',
    expected: 1,
  },
  {
    name: "retains a global provider projection",
    code: 'import { useEffect } from "react";\nglobalThis.document.querySelectorAll = replacement;\nconst Panel = () => {\n  useEffect(() => {\n    const targets = Array.from(document.querySelectorAll(".item"));\n    const observers = targets.map((target) => {\n      const observer = new IntersectionObserver(() => {}, { threshold: 0.2 });\n      observer.observe(target);\n      return observer;\n    });\n    return () => {\n      targets.map((target, index) => observers[index]?.unobserve(target));\n    };\n  }, []);\n  return null;\n};',
    expected: 1,
  },
  {
    name: "retains an unknown computed callable transport",
    code: 'import { useEffect } from "react";\nconst executor = provider[key];\nconst Panel = () => {\n  useEffect(() => {\n    const targets = Array.from(document.querySelectorAll(".item"));\n    const observers = targets.map((target) => {\n      const observer = new IntersectionObserver(() => {}, { threshold: 0.2 });\n      observer.observe(target);\n      return observer;\n    });\n    return () => {\n      targets.map((target, index) => observers[index]?.unobserve(target));\n    };\n  }, []);\n  return null;\n};',
    expected: 1,
  },
  {
    name: "retains constructor property extraction",
    code: 'import { useEffect } from "react";\nconst executor = (() => {}).constructor;\nconst Panel = () => {\n  useEffect(() => {\n    const targets = Array.from(document.querySelectorAll(".item"));\n    const observers = targets.map((target) => {\n      const observer = new IntersectionObserver(() => {}, { threshold: 0.2 });\n      observer.observe(target);\n      return observer;\n    });\n    return () => {\n      targets.map((target, index) => observers[index]?.unobserve(target));\n    };\n  }, []);\n  return null;\n};',
    expected: 1,
  },
  {
    name: "retains a sibling React namespace provider",
    code: 'import React, { useEffect } from "react";\nconst Panel = () => {\n  useEffect(() => {\n    const targets = Array.from(document.querySelectorAll(".item"));\n    const observers = targets.map((target) => {\n      const observer = new IntersectionObserver(() => {}, { threshold: 0.2 });\n      observer.observe(target);\n      return observer;\n    });\n    return () => {\n      targets.map((target, index) => observers[index]?.unobserve(target));\n    };\n  }, []);\n  return null;\n};',
    expected: 1,
  },
  {
    name: "retains canonical React require exposure",
    code: 'import { useEffect } from "react";\nrequire("react");\nconst Panel = () => {\n  useEffect(() => {\n    const targets = Array.from(document.querySelectorAll(".item"));\n    const observers = targets.map((target) => {\n      const observer = new IntersectionObserver(() => {}, { threshold: 0.2 });\n      observer.observe(target);\n      return observer;\n    });\n    return () => {\n      targets.map((target, index) => observers[index]?.unobserve(target));\n    };\n  }, []);\n  return null;\n};',
    expected: 1,
  },
  {
    name: "retains an escaped effect binding",
    code: 'import { useEffect } from "react";\ninstall(useEffect);\nconst Panel = () => {\n  useEffect(() => {\n    const targets = Array.from(document.querySelectorAll(".item"));\n    const observers = targets.map((target) => {\n      const observer = new IntersectionObserver(() => {}, { threshold: 0.2 });\n      observer.observe(target);\n      return observer;\n    });\n    return () => {\n      targets.map((target, index) => observers[index]?.unobserve(target));\n    };\n  }, []);\n  return null;\n};',
    expected: 1,
  },
  {
    name: "retains a spread observer option",
    code: 'import { useEffect } from "react";\nconst Panel = () => {\n  useEffect(() => {\n    const targets = Array.from(document.querySelectorAll(".item"));\n    const observers = targets.map((target) => {\n      const observer = new IntersectionObserver(() => {}, { ...options });\n      observer.observe(target);\n      return observer;\n    });\n    return () => {\n      targets.map((target, index) => observers[index]?.unobserve(target));\n    };\n  }, []);\n  return null;\n};',
    expected: 1,
  },
  {
    name: "retains a prototype option initializer",
    code: 'import { useEffect } from "react";\nconst Panel = () => {\n  useEffect(() => {\n    const targets = Array.from(document.querySelectorAll(".item"));\n    const observers = targets.map((target) => {\n      const observer = new IntersectionObserver(() => {}, { __proto__: null });\n      observer.observe(target);\n      return observer;\n    });\n    return () => {\n      targets.map((target, index) => observers[index]?.unobserve(target));\n    };\n  }, []);\n  return null;\n};',
    expected: 1,
  },
  {
    name: "retains an accessor option",
    code: 'import { useEffect } from "react";\nconst Panel = () => {\n  useEffect(() => {\n    const targets = Array.from(document.querySelectorAll(".item"));\n    const observers = targets.map((target) => {\n      const observer = new IntersectionObserver(() => {}, { get threshold() { return 0.2; } });\n      observer.observe(target);\n      return observer;\n    });\n    return () => {\n      targets.map((target, index) => observers[index]?.unobserve(target));\n    };\n  }, []);\n  return null;\n};',
    expected: 1,
  },
  {
    name: "retains a computed observer option",
    code: 'import { useEffect } from "react";\nconst Panel = () => {\n  useEffect(() => {\n    const targets = Array.from(document.querySelectorAll(".item"));\n    const observers = targets.map((target) => {\n      const observer = new IntersectionObserver(() => {}, { [key]: 0.2 });\n      observer.observe(target);\n      return observer;\n    });\n    return () => {\n      targets.map((target, index) => observers[index]?.unobserve(target));\n    };\n  }, []);\n  return null;\n};',
    expected: 1,
  },
  {
    name: "retains missing cleanup",
    code: 'import { useEffect } from "react";\nconst Panel = () => {\n  useEffect(() => {\n    const targets = Array.from(document.querySelectorAll(".item"));\n    const observers = targets.map((target) => {\n      const observer = new IntersectionObserver(() => {}, { threshold: 0.2 });\n      observer.observe(target);\n      return observer;\n    });\n\n  }, []);\n  return null;\n};',
    expected: 1,
  },
  {
    name: "retains second native callback observer argument",
    code: 'import { useEffect } from "react";\nconst Panel = () => {\n  useEffect(() => {\n    const targets = Array.from(document.querySelectorAll(".item"));\n    const observers = targets.map((target) => {\n      const observer = new IntersectionObserver((entries, sameObserver) => { sameObserver.observe(otherTarget); }, { threshold: 0.2 });\n      observer.observe(target);\n      return observer;\n    });\n    return () => {\n      targets.map((target, index) => observers[index]?.unobserve(target));\n    };\n  }, []);\n  return null;\n};',
    expected: 1,
  },
  {
    name: "retains rest native callback observer argument",
    code: 'import { useEffect } from "react";\nconst Panel = () => {\n  useEffect(() => {\n    const targets = Array.from(document.querySelectorAll(".item"));\n    const observers = targets.map((target) => {\n      const observer = new IntersectionObserver((...callbackArguments) => { callbackArguments.at(1).observe(otherTarget); }, { threshold: 0.2 });\n      observer.observe(target);\n      return observer;\n    });\n    return () => {\n      targets.map((target, index) => observers[index]?.unobserve(target));\n    };\n  }, []);\n  return null;\n};',
    expected: 1,
  },
  {
    name: "retains defaulted native callback entries",
    code: 'import { useEffect } from "react";\nconst Panel = () => {\n  useEffect(() => {\n    const targets = Array.from(document.querySelectorAll(".item"));\n    const observers = targets.map((target) => {\n      const observer = new IntersectionObserver((entries = fallbackEntries) => {}, { threshold: 0.2 });\n      observer.observe(target);\n      return observer;\n    });\n    return () => {\n      targets.map((target, index) => observers[index]?.unobserve(target));\n    };\n  }, []);\n  return null;\n};',
    expected: 1,
  },
  {
    name: "retains destructured native callback entries",
    code: 'import { useEffect } from "react";\nconst Panel = () => {\n  useEffect(() => {\n    const targets = Array.from(document.querySelectorAll(".item"));\n    const observers = targets.map((target) => {\n      const observer = new IntersectionObserver(([entry]) => {}, { threshold: 0.2 });\n      observer.observe(target);\n      return observer;\n    });\n    return () => {\n      targets.map((target, index) => observers[index]?.unobserve(target));\n    };\n  }, []);\n  return null;\n};',
    expected: 1,
  },
];

describe("effect-observer-needs-disconnect closed mapped snapshots", () => {
  it.each(cases)("$name", ({ code, expected }) => {
    const result = runRule(effectObserverNeedsDisconnect, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
});
