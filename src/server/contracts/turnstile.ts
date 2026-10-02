/**
 * The action name each public form gives its widget.
 *
 * Cloudflare signs the action into the token, and the server refuses a token
 * whose action is not the one for the form it arrived with. Without that, a
 * token solved once on the lightest form could be carried to any other, so
 * every form would only ever be as well guarded as the easiest one.
 *
 * Cloudflare allows up to 32 letters, digits, underscores and hyphens.
 */
export const TURNSTILE_ACTIONS = {
  pledge: "pledge",
  redeemLookup: "redeem_lookup",
  changeRequest: "change_request",
  withdrawConsent: "withdraw_consent",
} as const;

export type TurnstileAction =
  (typeof TURNSTILE_ACTIONS)[keyof typeof TURNSTILE_ACTIONS];
