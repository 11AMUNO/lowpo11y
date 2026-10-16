"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { Notice } from "@/components/ui/feedback";
import { api, ApiError } from "@/lib/api-client";

export function SetupForm({ needsToken }: { needsToken: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    if (form.get("password") !== form.get("confirm")) {
      setError("The two passwords don't match.");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await api("/api/auth/setup", {
        body: {
          token: needsToken ? String(form.get("token")) : undefined,
          email: String(form.get("email")),
          displayName: String(form.get("displayName")),
          password: String(form.get("password")),
        },
      });
      router.replace("/admin");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Setup failed. Try again.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      {error ? (
        <Notice tone="warn" title="Setup failed">
          <span role="alert">{error}</span>
        </Notice>
      ) : null}
      {needsToken ? (
        <Field label="Setup token" hint="The value of the SETUP_TOKEN environment variable on your host.">
          <Input name="token" type="password" autoComplete="off" required />
        </Field>
      ) : null}
      <Field label="Your name">
        <Input name="displayName" autoComplete="name" required maxLength={80} />
      </Field>
      <Field label="Email">
        <Input name="email" type="email" autoComplete="username" required />
      </Field>
      <Field label="Password" hint="At least 12 characters. A few random words work well.">
        <Input name="password" type="password" autoComplete="new-password" required minLength={12} />
      </Field>
      <Field label="Confirm password">
        <Input name="confirm" type="password" autoComplete="new-password" required minLength={12} />
      </Field>
      <Button type="submit" variant="primary" size="lg" disabled={busy}>
        {busy ? "Creating account…" : "Create admin account"}
      </Button>
    </form>
  );
}
