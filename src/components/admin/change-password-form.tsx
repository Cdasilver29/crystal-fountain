"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { changeOwnPasswordInput } from "@/server/contracts/admin-users";

/**
 * Setting your own password.
 *
 * The current one is asked for even when a forced change is what brought
 * somebody here. A temporary password is known to whoever generated it, and
 * asking for it proves the person at the keyboard is the one it was handed to
 * rather than somebody who found an unattended screen.
 *
 * On success this navigates with a full page load rather than a router push, so
 * the server re-reads the account and the forced change flag is gone before the
 * next screen decides whether to bounce them back here.
 */
export function ChangePasswordForm({ forced }: { forced: boolean }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();

    const parsed = changeOwnPasswordInput.safeParse({
      currentPassword,
      newPassword,
      confirmPassword,
    });

    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "form");
        if (!next[key]) next[key] = issue.message;
      }
      setErrors(next);
      return;
    }

    setErrors({});
    setBusy(true);

    try {
      const response = await fetch("/api/admin/change-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data),
      });

      const body = await response.json().catch(() => null);

      if (!response.ok) {
        setErrors(
          body?.errors ?? {
            form: body?.title ?? "We could not change your password.",
          },
        );
        setBusy(false);
        return;
      }

      window.location.assign("/admin/pledges");
    } catch {
      setErrors({
        form: "We could not reach the server. Check your connection.",
      });
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {forced && (
        <p className="rounded-lg bg-campfire/10 px-3 py-2.5 text-sm leading-relaxed text-navy">
          Somebody else set the password you just signed in with, so it is not
          yet yours. Choose your own to carry on.
        </p>
      )}

      {errors.form && (
        <p
          role="alert"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {errors.form}
        </p>
      )}

      <div>
        <Label htmlFor="currentPassword">Current password</Label>
        <Input
          id="currentPassword"
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          aria-invalid={Boolean(errors.currentPassword)}
          onChange={(e) => setCurrentPassword(e.target.value)}
          className="mt-2"
        />
        {errors.currentPassword && (
          <p className="mt-1 text-sm text-red-700">{errors.currentPassword}</p>
        )}
      </div>

      <div>
        <Label htmlFor="newPassword">New password</Label>
        <Input
          id="newPassword"
          type="password"
          autoComplete="new-password"
          value={newPassword}
          aria-invalid={Boolean(errors.newPassword)}
          onChange={(e) => setNewPassword(e.target.value)}
          className="mt-2"
        />
        {errors.newPassword && (
          <p className="mt-1 text-sm text-red-700">{errors.newPassword}</p>
        )}
      </div>

      <div>
        <Label htmlFor="confirmPassword">Repeat new password</Label>
        <Input
          id="confirmPassword"
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          aria-invalid={Boolean(errors.confirmPassword)}
          onChange={(e) => setConfirmPassword(e.target.value)}
          className="mt-2"
        />
        {errors.confirmPassword && (
          <p className="mt-1 text-sm text-red-700">{errors.confirmPassword}</p>
        )}
      </div>

      <Button type="submit" disabled={busy} className="w-full">
        {busy ? "Saving" : "Set my password"}
      </Button>
    </form>
  );
}
