export {
  contactClear,
  contactShow,
  contactUpdate,
  decline,
  optIn,
  optOut,
  status,
} from "./consent.js";
export {
  dimensionsJsonByteLength,
  emitUsage,
  USAGE_DIMENSIONS_MAX_JSON_BYTES,
  type UsageDimensions,
} from "./emit.js";
export { type FeedbackKind, submitFeedback } from "./feedback.js";
export {
  scopeCompleteDimensions,
  scopeCreatedDimensions,
  scopeStartDimensions,
  scopeStopDimensions,
  triageDimensions,
  xbriefInventoryDimensions,
} from "./metric-dimensions.js";
export {
  buildSessionSummaryDimensions,
  bumpAgentTurn,
  clearSession,
  markInventoryEmitted,
  recordCheckRun,
  recordScopeCancelled,
  recordScopeCompleted,
  recordScopeCreated,
  shouldEmitInventory,
} from "./session-state.js";
export {
  drainSoftEmits,
  resetPendingSoftEmitsForTests,
  softEmitUsage,
} from "./soft-emit.js";
export { readState } from "./storage.js";
export {
  type ConsentSignal,
  formatSignal,
  parseContact,
  signal,
} from "./types.js";
