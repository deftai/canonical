export type DeploymentId = {
    product: string;
    platform: string;
    environment: string;
    version: string;
    customer?: string;
    raw: string;
};
export type ParseDeploymentIdResult = {
    ok: true;
    id: DeploymentId;
} | {
    ok: false;
    reason: string;
};
/** Strict parse of a deployment ID per DEP-1. No trimming or normalization — the raw string is
 * matched exactly against the grammar. */
export declare function parseDeploymentId(raw: string): ParseDeploymentIdResult;
//# sourceMappingURL=deployment.d.ts.map