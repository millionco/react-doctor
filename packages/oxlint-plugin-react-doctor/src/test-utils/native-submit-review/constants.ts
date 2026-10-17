export const NATIVE_SUBMIT_REVIEW_CASES = [
  {
    name: "baseline-closed-native-submit",
    code: 'import { Fragment } from "react";\nimport { useNavigate } from "react-router-dom";\nexport const Screen = () => {\n  const navigate = useNavigate();\n  const CREATE_SESSION = () => { navigate("/next"); };\n  const onSubmit = (event: { preventDefault: () => void }) => { event.preventDefault(); CREATE_SESSION(); };\n  return <form onSubmit={onSubmit}><button type="submit">Go</button></form>;\n};\n',
    expected: 0,
    sourceSha256: "d97c330fa6cbc329f7c8b0f53bca053059c704ac0eb9b320d4641aaa98c5e6bd",
  },
  {
    name: "merged-helper-interface",
    code: 'import { Fragment } from "react";\nimport { useNavigate } from "react-router-dom";\nexport const Screen = () => {\n  const navigate = useNavigate();\n  const CREATE_SESSION = () => { navigate("/next"); };\n  interface CREATE_SESSION {}\n  const onSubmit = (event: { preventDefault: () => void }) => { event.preventDefault(); CREATE_SESSION(); };\n  return <form onSubmit={onSubmit}><button type="submit">Go</button></form>;\n};\n',
    expected: 0,
    sourceSha256: "67b2103188705727a8591017041caecca09f992c5a6ce82bc04670f309113e22",
  },
  {
    name: "merged-handler-interface",
    code: 'import { Fragment } from "react";\nimport { useNavigate } from "react-router-dom";\nexport const Screen = () => {\n  const navigate = useNavigate();\n  const CREATE_SESSION = () => { navigate("/next"); };\n  const onSubmit = (event: { preventDefault: () => void }) => { event.preventDefault(); CREATE_SESSION(); };\n  interface onSubmit {}\n  return <form onSubmit={onSubmit}><button type="submit">Go</button></form>;\n};\n',
    expected: 0,
    sourceSha256: "2380ee77537051386dcc70c03a38a7a2eaa5474ed8e1c94bec2e09d07e0ebff6",
  },
  {
    name: "merged-component-interface",
    code: 'import { Fragment } from "react";\nimport { useNavigate } from "react-router-dom";\nexport const Screen = () => {\n  const navigate = useNavigate();\n  const CREATE_SESSION = () => { navigate("/next"); };\n  const onSubmit = (event: { preventDefault: () => void }) => { event.preventDefault(); CREATE_SESSION(); };\n  return <form onSubmit={onSubmit}><button type="submit">Go</button></form>;\n};\ninterface Screen {}\n',
    expected: 0,
    sourceSha256: "a1d62ccd34ae39271b8f585e952ed3db449f153faf58f0ab3ff3d9aba8b657bd",
  },
  {
    name: "merged-fragment-interface",
    code: 'import { Fragment } from "react";\nimport { useNavigate } from "react-router-dom";\ninterface Fragment {}\nexport const Screen = () => {\n  const navigate = useNavigate();\n  const CREATE_SESSION = () => { navigate("/next"); };\n  const onSubmit = (event: { preventDefault: () => void }) => { event.preventDefault(); CREATE_SESSION(); };\n  return <Fragment><form onSubmit={onSubmit}><button type="submit">Go</button></form></Fragment>;\n};\n',
    expected: 0,
    sourceSha256: "5ea70582ca8d9f1dbe23343a613ffa044523b60be4ec26b0df1266db977043eb",
  },
  {
    name: "direct-render-positive",
    code: 'import { useNavigate } from "react-router-dom";\nexport const Screen = () => {\n  const navigate = useNavigate();\n  navigate("/next");\n  return <form />;\n};\n',
    expected: 1,
    sourceSha256: "a1e0e042f38168a211bcdc28e34ddf77561d84e5bbe5fb028c1528dd4434cd21",
  },
  {
    name: "direct-render-merged-hook-interface",
    code: 'import { useNavigate } from "react-router-dom";\ninterface useNavigate {}\nexport const Screen = () => {\n  const navigate = useNavigate();\n  navigate("/next");\n  return <form />;\n};\n',
    expected: 1,
    sourceSha256: "5025b364bbd8ae469caab2a14e8db73bb881f0e03307fd9ee362b841c50c66e6",
  },
  {
    name: "direct-render-merged-navigate-interface",
    code: 'import { useNavigate } from "react-router-dom";\nexport const Screen = () => {\n  const navigate = useNavigate();\n  interface navigate {}\n  navigate("/next");\n  return <form />;\n};\n',
    expected: 1,
    sourceSha256: "8ca98db04cc6e38fafb132ad7c74cbec6e6c2112adc1df1de9d1747a55a392ba",
  },
  {
    name: "selected-module-router-write",
    code: 'import { Fragment } from "react";\nimport { useNavigate } from "react-router-dom";\nconst loadedRouter=module.require("react-router-dom"); loadedRouter.useNavigate=replacement;\nexport const Screen = () => {\n  const navigate = useNavigate();\n  const CREATE_SESSION = () => { navigate("/next"); };\n  const onSubmit = (event: { preventDefault: () => void }) => { event.preventDefault(); CREATE_SESSION(); };\n  return <form onSubmit={onSubmit}><button type="submit">Go</button></form>;\n};\n',
    expected: 1,
  },
  {
    name: "selected-module-router-member-write",
    code: 'import { Fragment } from "react";\nimport { useNavigate } from "react-router-dom";\nmodule.require("react-router-dom").useNavigate=replacement;\nexport const Screen = () => {\n  const navigate = useNavigate();\n  const CREATE_SESSION = () => { navigate("/next"); };\n  const onSubmit = (event: { preventDefault: () => void }) => { event.preventDefault(); CREATE_SESSION(); };\n  return <form onSubmit={onSubmit}><button type="submit">Go</button></form>;\n};\n',
    expected: 1,
  },
  {
    name: "selected-module-router-default-write",
    code: 'import { Fragment } from "react";\nimport { useNavigate } from "react-router-dom";\nconst loadedRouter=module.require("react-router-dom").default; loadedRouter.useNavigate=replacement;\nexport const Screen = () => {\n  const navigate = useNavigate();\n  const CREATE_SESSION = () => { navigate("/next"); };\n  const onSubmit = (event: { preventDefault: () => void }) => { event.preventDefault(); CREATE_SESSION(); };\n  return <form onSubmit={onSubmit}><button type="submit">Go</button></form>;\n};\n',
    expected: 1,
  },
  {
    name: "foreign-module-router-write",
    code: 'import { Fragment } from "react";\nimport { useNavigate } from "react-router-dom";\nconst loadedRouter=module.require("foreign-router"); loadedRouter.useNavigate=replacement;\nexport const Screen = () => {\n  const navigate = useNavigate();\n  const CREATE_SESSION = () => { navigate("/next"); };\n  const onSubmit = (event: { preventDefault: () => void }) => { event.preventDefault(); CREATE_SESSION(); };\n  return <form onSubmit={onSubmit}><button type="submit">Go</button></form>;\n};\n',
    expected: 0,
  },
  {
    name: "genuine-local-module-router-write",
    code: 'import { Fragment } from "react";\nimport { useNavigate } from "react-router-dom";\nconst module={require:(_source:string)=>({useNavigate:0})}; const loadedRouter=module.require("react-router-dom"); loadedRouter.useNavigate=1;\nexport const Screen = () => {\n  const navigate = useNavigate();\n  const CREATE_SESSION = () => { navigate("/next"); };\n  const onSubmit = (event: { preventDefault: () => void }) => { event.preventDefault(); CREATE_SESSION(); };\n  return <form onSubmit={onSubmit}><button type="submit">Go</button></form>;\n};\n',
    expected: 0,
  },
  {
    name: "readonly-module-router-read",
    code: 'import { Fragment } from "react";\nimport { useNavigate } from "react-router-dom";\nconst loadedRouter=module.require("react-router-dom"); void loadedRouter.useNavigate;\nexport const Screen = () => {\n  const navigate = useNavigate();\n  const CREATE_SESSION = () => { navigate("/next"); };\n  const onSubmit = (event: { preventDefault: () => void }) => { event.preventDefault(); CREATE_SESSION(); };\n  return <form onSubmit={onSubmit}><button type="submit">Go</button></form>;\n};\n',
    expected: 0,
  },
  {
    name: "selected-global-require-router-write",
    code: 'import { Fragment } from "react";\nimport { useNavigate } from "react-router-dom";\nconst loadedRouter=require("react-router-dom"); loadedRouter.useNavigate=replacement;\nexport const Screen = () => {\n  const navigate = useNavigate();\n  const CREATE_SESSION = () => { navigate("/next"); };\n  const onSubmit = (event: { preventDefault: () => void }) => { event.preventDefault(); CREATE_SESSION(); };\n  return <form onSubmit={onSubmit}><button type="submit">Go</button></form>;\n};\n',
    expected: 1,
  },
  {
    name: "selected-module-router-alias-write",
    code: 'import { Fragment } from "react";\nimport { useNavigate } from "react-router-dom";\nconst loadedRouter=module.require("react-router-dom"); const routerAlias=loadedRouter; routerAlias.useNavigate=replacement;\nexport const Screen = () => {\n  const navigate = useNavigate();\n  const CREATE_SESSION = () => { navigate("/next"); };\n  const onSubmit = (event: { preventDefault: () => void }) => { event.preventDefault(); CREATE_SESSION(); };\n  return <form onSubmit={onSubmit}><button type="submit">Go</button></form>;\n};\n',
    expected: 1,
  },
  {
    name: "selected-module-router-opaque-escape",
    code: 'import { Fragment } from "react";\nimport { useNavigate } from "react-router-dom";\nconst loadedRouter=module.require("react-router-dom"); mutate(loadedRouter);\nexport const Screen = () => {\n  const navigate = useNavigate();\n  const CREATE_SESSION = () => { navigate("/next"); };\n  const onSubmit = (event: { preventDefault: () => void }) => { event.preventDefault(); CREATE_SESSION(); };\n  return <form onSubmit={onSubmit}><button type="submit">Go</button></form>;\n};\n',
    expected: 1,
  },
  {
    name: "selected-module-router-delete",
    code: 'import { Fragment } from "react";\nimport { useNavigate } from "react-router-dom";\ndelete module.require("react-router-dom").useNavigate;\nexport const Screen = () => {\n  const navigate = useNavigate();\n  const CREATE_SESSION = () => { navigate("/next"); };\n  const onSubmit = (event: { preventDefault: () => void }) => { event.preventDefault(); CREATE_SESSION(); };\n  return <form onSubmit={onSubmit}><button type="submit">Go</button></form>;\n};\n',
    expected: 1,
  },
  {
    name: "selected-module-router-destructuring-write",
    code: 'import { Fragment } from "react";\nimport { useNavigate } from "react-router-dom";\n({hook:module.require("react-router-dom").useNavigate}=replacement);\nexport const Screen = () => {\n  const navigate = useNavigate();\n  const CREATE_SESSION = () => { navigate("/next"); };\n  const onSubmit = (event: { preventDefault: () => void }) => { event.preventDefault(); CREATE_SESSION(); };\n  return <form onSubmit={onSubmit}><button type="submit">Go</button></form>;\n};\n',
    expected: 1,
  },
  {
    name: "selected-module-router-unrelated-write",
    code: 'import { Fragment } from "react";\nimport { useNavigate } from "react-router-dom";\nconst loadedRouter=module.require("react-router-dom"); loadedRouter.unrelated=replacement;\nexport const Screen = () => {\n  const navigate = useNavigate();\n  const CREATE_SESSION = () => { navigate("/next"); };\n  const onSubmit = (event: { preventDefault: () => void }) => { event.preventDefault(); CREATE_SESSION(); };\n  return <form onSubmit={onSubmit}><button type="submit">Go</button></form>;\n};\n',
    expected: 0,
  },
  {
    name: "selected-module-router-computed-key-read",
    code: 'import { Fragment } from "react";\nimport { useNavigate } from "react-router-dom";\nconst loadedRouter=module.require("react-router-dom"); destination[loadedRouter.useNavigate]=replacement;\nexport const Screen = () => {\n  const navigate = useNavigate();\n  const CREATE_SESSION = () => { navigate("/next"); };\n  const onSubmit = (event: { preventDefault: () => void }) => { event.preventDefault(); CREATE_SESSION(); };\n  return <form onSubmit={onSubmit}><button type="submit">Go</button></form>;\n};\n',
    expected: 0,
  },
  {
    name: "genuine-local-module-merged-interface",
    code: 'import { Fragment } from "react";\nimport { useNavigate } from "react-router-dom";\nconst module={require:(_source:string)=>({useNavigate:0})}; interface module {} const loadedRouter=module.require("react-router-dom"); loadedRouter.useNavigate=1;\nexport const Screen = () => {\n  const navigate = useNavigate();\n  const CREATE_SESSION = () => { navigate("/next"); };\n  const onSubmit = (event: { preventDefault: () => void }) => { event.preventDefault(); CREATE_SESSION(); };\n  return <form onSubmit={onSubmit}><button type="submit">Go</button></form>;\n};\n',
    expected: 0,
  },
];
