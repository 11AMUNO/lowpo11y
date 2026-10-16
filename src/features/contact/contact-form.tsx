"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/feedback";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { api, ApiError, fieldErrors } from "@/lib/api-client";

const KINDS = [
  { value: "general", label: "General question" },
  { value: "takedown", label: "Rights problem or takedown" },
  { value: "correction", label: "Correction to a listing" },
  { value: "suggestion", label: "Suggestion" },
] as const;

export function ContactForm({ initialKind = "general", initialPath = "" }: { initialKind?: string; initialPath?: string }) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState(KINDS.some((k) => k.value === initialKind) ? initialKind : "general");

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setErrors({});
    setFailure(null);
    try {
      await api("/api/contact", {
        body: {
          kind,
          name: String(f.get("name") ?? ""),
          email: String(f.get("email") ?? ""),
          subject: String(f.get("subject") ?? ""),
          message: String(f.get("message") ?? ""),
          pagePath: String(f.get("pagePath") ?? ""),
          website: String(f.get("website") ?? ""),
        },
      });
      setSent(true);
    } catch (err) {
      const fields = fieldErrors(err);
      setErrors(fields);
      if (!Object.keys(fields).length) setFailure(err instanceof ApiError ? err.message : "Your message didn't send. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <Notice title="Message sent">
        <p role="status">Thanks. We reply by email, usually within two working days. Takedown requests are handled first.</p>
      </Notice>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {failure ? (
        <Notice tone="warn" title="Not sent">
          <span role="alert">{failure}</span>
        </Notice>
      ) : null}
      <Field label="What is it about?">
        <Select name="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
          {KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Your name" error={errors.name} required>
          <Input name="name" autoComplete="name" maxLength={80} required />
        </Field>
        <Field label="Email" error={errors.email} hint="Only used to reply to you." required>
          <Input name="email" type="email" autoComplete="email" maxLength={200} required />
        </Field>
      </div>
      <Field label="Subject" error={errors.subject} required>
        <Input name="subject" maxLength={140} required />
      </Field>
      <Field
        label="Page on this site (optional)"
        error={errors.pagePath}
        hint={kind === "takedown" ? "The listing you're reporting, e.g. /assets/wooden-crate." : "e.g. /textures/red-brick"}
      >
        <Input name="pagePath" defaultValue={initialPath} maxLength={300} placeholder="/assets/…" />
      </Field>
      <Field
        label="Message"
        error={errors.message}
        required
        hint={kind === "takedown" ? "Say who you are, how you hold the rights, and link the original source if you can." : undefined}
      >
        <Textarea name="message" rows={7} maxLength={5000} required />
      </Field>
      {/* Honeypot for bots; hidden from people and assistive tech. */}
      <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label>
          Website
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <div>
        <Button type="submit" variant="primary" size="lg" disabled={busy}>
          {busy ? "Sending…" : "Send message"}
        </Button>
      </div>
    </form>
  );
}
