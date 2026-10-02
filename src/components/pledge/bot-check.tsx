"use client";

import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { useRef, useState } from "react";

import type { TurnstileAction } from "@/server/contracts/turnstile";

/**
 * The bot check for the /redeem forms.
 *
 * One widget per form, each rendered with that form's own action name, because
 * the server refuses a token solved for a different form. A token is good for
 * one submission: whatever the answer, the form asks for a fresh one before
 * the next attempt.
 *
 * With no site key the check is switched off, the widget does not render and
 * every form submits as it did before. The server decides whether that is
 * allowed; this only follows.
 */
export function useBotCheck(siteKey: string | null) {
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<TurnstileInstance | null>(null);

  return {
    siteKey,
    token,
    error,
    ref,
    setToken,
    setError,
    /** A spent or expired token is thrown away and the widget runs again. */
    reset() {
      setToken(null);
      ref.current?.reset();
    },
    /**
     * Whether the form may submit. When it may not, says why under the widget,
     * which saves a round trip the server would refuse anyway.
     */
    ready(): boolean {
      if (!siteKey || token) return true;
      setError("Please complete the security check before sending.");
      return false;
    },
  };
}

export type BotCheckState = ReturnType<typeof useBotCheck>;

export function BotCheck({
  check,
  action,
}: {
  check: BotCheckState;
  action: TurnstileAction;
}) {
  if (!check.siteKey) return null;

  return (
    <div className="mt-4">
      <Turnstile
        ref={check.ref}
        siteKey={check.siteKey}
        onSuccess={(token) => {
          check.setToken(token);
          check.setError(null);
        }}
        onExpire={check.reset}
        onError={() => {
          check.setToken(null);
          check.setError(
            "The security check could not load. Check your connection and try again.",
          );
        }}
        options={{ action, theme: "light", size: "flexible" }}
      />
      {check.error && (
        <p role="alert" className="mt-1.5 text-sm text-red-700">
          {check.error}
        </p>
      )}
    </div>
  );
}
