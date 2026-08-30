import { ProvingServiceError } from "./proving-service.js";
/** Error thrown when a block reorg is detected (HTTP 409 status). */
export declare class ReorgError extends Error {
    constructor(message: string);
}
/**
 * The address the pool screens for this transaction is on the sanctions list — a deposit's own
 * depositor, the shadow account an interaction runs through, or an invoke target the pool requires
 * screening for. Terminal: retrying with the same address will not succeed.
 */
export declare class ScreeningRejected extends Error {
    readonly name = "ScreeningRejected";
    constructor(reason?: string);
}
/**
 * Screening could not be completed. It fails closed either way: no signature, no transaction.
 *
 * - The screener (FPI cloud function or upstream) or the pool's policy list could not be read.
 *   Transient, so the caller may retry.
 * - The pool answered a policy variant the interceptor's ABI cannot decode. Clears only once the
 *   interceptor is upgraded.
 */
export declare class ScreeningUnavailable extends Error {
    readonly name = "ScreeningUnavailable";
    constructor(reason?: string);
}
/**
 * Map a {@link ProvingServiceError} to a typed screening error, or `undefined`
 * if it is not a screening verdict so the caller can rethrow the original.
 *
 * Code 10000 ("Transaction rejected") is overloaded — the interceptor also
 * emits it for non-pool blocks and for unexpected interceptor exceptions
 * (whose `data` is the raw error message). We therefore switch on the *exact*
 * opaque reasons above rather than treating every 10000 as terminal: a
 * transient interceptor fault must not be reported as a permanent sanctions
 * rejection the user is told never to retry.
 */
export declare function screeningErrorFromProvingError(error: ProvingServiceError): ScreeningRejected | ScreeningUnavailable | undefined;
//# sourceMappingURL=errors.d.ts.map