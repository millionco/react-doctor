"use strict";
(self["webpackChunkvideo"] = self["webpackChunkvideo"] || []).push([[789],{

/***/ 8789
(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   ZodZypesInternals: () => (/* binding */ ZodZypesInternals),
/* harmony export */   zColor: () => (/* binding */ zColor),
/* harmony export */   zMatrix: () => (/* binding */ zMatrix),
/* harmony export */   zTextarea: () => (/* binding */ zTextarea)
/* harmony export */ });
/* harmony import */ var remotion_no_react__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(9802);
/* harmony import */ var zod__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(3838);
// src/z-color.ts


var REMOTION_COLOR_BRAND = "__remotion-color";
var parseColor = (value) => {
  const colored = remotion_no_react__WEBPACK_IMPORTED_MODULE_0__.NoReactInternals.processColor(value).toString(16).padStart(8, "0");
  const opacity = parseInt(colored.slice(0, 2), 16);
  const r = parseInt(colored.slice(2, 4), 16);
  const g = parseInt(colored.slice(4, 6), 16);
  const b = parseInt(colored.slice(6, 8), 16);
  return { a: opacity, r, g, b };
};
var zColor = () => zod__WEBPACK_IMPORTED_MODULE_1__.z.string().refine((value) => {
  try {
    parseColor(value);
    return true;
  } catch {
    return false;
  }
}, { message: "Invalid color" }).describe(REMOTION_COLOR_BRAND);

// src/z-matrix.ts

var REMOTION_MATRIX_BRAND = "__remotion-matrix";
var zMatrix = () => zod__WEBPACK_IMPORTED_MODULE_1__.z.array(zod__WEBPACK_IMPORTED_MODULE_1__.z.number().step(0.01)).refine((value) => {
  const count = value.length;
  const root = Math.sqrt(count);
  return Number.isInteger(root) && root > 0;
}, { message: "Invalid matrix, must be a square matrix" }).describe(REMOTION_MATRIX_BRAND);

// src/z-textarea.ts

var REMOTION_TEXTAREA_BRAND = "__remotion-textarea";
var zTextarea = () => zod__WEBPACK_IMPORTED_MODULE_1__.z.string().describe(REMOTION_TEXTAREA_BRAND);

// src/index.ts
var ZodZypesInternals = {
  parseColor,
  REMOTION_COLOR_BRAND,
  REMOTION_TEXTAREA_BRAND,
  REMOTION_MATRIX_BRAND
};



/***/ }

}]);
//# sourceMappingURL=789.bundle.js.map