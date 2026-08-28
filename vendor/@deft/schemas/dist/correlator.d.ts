export type ParseCorrelatorResult = {
    ok: true;
    value: string;
} | {
    ok: false;
    reason: string;
};
/** Strict parse of a correlator per CORR-1. No trimming or normalization. */
export declare function parseCorrelator(raw: string): ParseCorrelatorResult;
//# sourceMappingURL=correlator.d.ts.map