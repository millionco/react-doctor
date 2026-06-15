export const PROFILING_EXPORT_VERSION = 5;

// Upper bound on how long `stop()` waits for the backend to return profiling
// data before settling (with whatever was collected), so a non-responding
// backend can't hang the caller.
export const PROFILING_STOP_TIMEOUT_MS = 30_000;

// React DevTools operation opcodes (react-devtools-shared/src/constants.js).
export const TREE_OPERATION_ADD = 1;
export const TREE_OPERATION_REMOVE = 2;
export const TREE_OPERATION_REORDER_CHILDREN = 3;
export const TREE_OPERATION_UPDATE_TREE_BASE_DURATION = 4;
export const TREE_OPERATION_UPDATE_ERRORS_OR_WARNINGS = 5;
export const TREE_OPERATION_SET_SUBTREE_MODE = 7;
export const TREE_OPERATION_APPLIED_ACTIVITY_SLICE_CHANGE = 13;

// React DevTools element types (react-devtools-shared/src/frontend/types.js).
export const ELEMENT_TYPE_CLASS = 1;
export const ELEMENT_TYPE_FUNCTION = 5;
export const ELEMENT_TYPE_FORWARD_REF = 6;
export const ELEMENT_TYPE_MEMO = 8;
export const ELEMENT_TYPE_ROOT = 11;
export const ELEMENT_TYPE_VIRTUAL = 15;

export const FORGET_WRAPPER_PREFIX = "Forget(";
