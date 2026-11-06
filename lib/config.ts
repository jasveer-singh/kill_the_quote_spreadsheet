/** RFx base currency and pricing basis everything is normalized to. */
export const BASE_CURRENCY = "INR";
export const BASE_PRICE_BASIS = "per_unit";

/** Default Claude model for extraction; override with ANTHROPIC_MODEL or the `model` option. */
export const DEFAULT_MODEL = "claude-sonnet-5-5";

/**
 * Assumed conversion rates into INR (1 unit of currency = N INR).
 * An assumption, not a market rate: every converted line records the rate it used.
 */
export const DEFAULT_FX_RATES_TO_INR: Record<string, number> = {
  INR: 1,
  USD: 83,
};
