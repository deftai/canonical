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
  drainSoftEmits,
  emitUsage,
  resetPendingSoftEmitsForTests,
  softEmitUsage,
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
  bump,
  clearSession,
  markInventoryEmitted,
  shouldEmitInventory,
} from "./session-state.js";
export { readState } from "./storage.js";
export { type ConsentSignal, formatSignal, parseContact, signal } from "./types.js";
