"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/form";
import { api, ApiError, fieldErrors } from "@/lib/api-client";

export function NewCollectionForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setErrors({});
    setFailure(null);
    try {
      const { id } = await api<{ id: string }>("/api/admin/collections", { body: { title: String(f.get("title")), summary: String(f.get("summary")) } });
      router.push(`/admin/collections/${id}`);
    } catch (err) {
      const fields = fieldErrors(err);
      setErrors(fields);
      if (!Object.keys(fields).length) setFailure(err instanceof ApiError ? err.message : "The collection wasn't created. Try again.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {failure ? (
        <Notice tone="warn" title="Not created">
          <span role="alert">{failure}</span>
        </Notice>
      ) : null}
      <Field label="Title" error={errors.title} required>
        <Input name="title" maxLength={120} autoFocus placeholder="Industrial yard kit" />
      </Field>
      <Field label="Summary" error={errors.summary}>
        <Input name="summary" maxLength={240} />
      </Field>
      <div>
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? "Creating…" : "Create collection"}
        </Button>
      </div>
    </form>
  );
}
