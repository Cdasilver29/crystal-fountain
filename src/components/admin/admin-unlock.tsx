"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * The unlock form. Shown in place of the table when the session cookie is
 * missing, so the admin screen stays a single route.
 */
export function AdminUnlock() {
  const router = useRouter();
  const [secret, setSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/admin/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ secret }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setError(body?.title ?? "That did not work.");
        setBusy(false);
        return;
      }

      setSecret("");
      router.refresh();
    } catch {
      setError("Could not reach the server.");
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="mx-auto mt-16 w-full max-w-sm rounded-2xl border border-black/5 bg-white p-6 shadow-sm"
    >
      <h1 className="text-lg font-semibold text-navy">Admin</h1>
      <p className="mt-1 text-sm text-neutral-600">
        Enter the shared secret to see the pledge list.
      </p>

      <div className="mt-5">
        <Label htmlFor="secret" className="text-sm text-neutral-700">
          Admin secret
        </Label>
        <Input
          id="secret"
          type="password"
          autoComplete="current-password"
          value={secret}
          onChange={(event) => setSecret(event.target.value)}
          aria-invalid={Boolean(error)}
          className="mt-1.5"
        />
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <Button
        type="submit"
        disabled={busy || secret.length === 0}
        className="mt-5 w-full bg-navy text-white hover:bg-navy/90"
      >
        {busy ? "Checking..." : "Unlock"}
      </Button>
    </form>
  );
}
