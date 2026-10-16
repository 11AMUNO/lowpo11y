"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/feedback";
import { Field, Input, Select } from "@/components/ui/form";
import { api, ApiError, fieldErrors } from "@/lib/api-client";
import { ASSET_TYPE_LABEL, ASSET_TYPES } from "@/lib/assets/schemas";

export function NewAssetForm() {
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
      const { id } = await api<{ id: string }>("/api/admin/assets", {
        body: { title: String(f.get("title")), assetType: String(f.get("assetType")), shortDescription: String(f.get("shortDescription")) },
      });
      router.push(`/admin/assets/${id}`);
    } catch (err) {
      const fields = fieldErrors(err);
      setErrors(fields);
      if (!Object.keys(fields).length) setFailure(err instanceof ApiError ? err.message : "The asset wasn't created. Try again.");
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
        <Input name="title" maxLength={120} required autoFocus placeholder="Wooden crate" />
      </Field>
      <Field label="Type">
        <Select name="assetType" defaultValue="model">
          {ASSET_TYPES.map((t) => (
            <option key={t} value={t}>
              {ASSET_TYPE_LABEL[t]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Short description" error={errors.shortDescription} hint="Optional now; needed before publishing.">
        <Input name="shortDescription" maxLength={240} />
      </Field>
      <div>
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? "Creating…" : "Create draft"}
        </Button>
      </div>
    </form>
  );
}
