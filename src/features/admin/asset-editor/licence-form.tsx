"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/feedback";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import { api, fieldErrors } from "@/lib/api-client";
import { PROVENANCE_KINDS, PROVENANCE_LABEL } from "@/lib/assets/schemas";
import { formatDate } from "@/lib/format";
import type { EditorAsset, Option } from "./types";
import { useMutation } from "./use-mutation";

export function LicenceForm({ asset, licences, readOnly }: { asset: EditorAsset; licences: (Option & { attribution: boolean | null })[]; readOnly: boolean }) {
  const { busy, run } = useMutation();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [licenceId, setLicenceId] = useState(asset.licenceId ?? "");
  const [attest, setAttest] = useState(!!asset.attestedAt);
  const chosen = licences.find((l) => l.id === licenceId);
  const licenceChanged = licenceId !== (asset.licenceId ?? "");

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setErrors({});
    const body = {
      licenceId: licenceId || null,
      attributionText: String(f.get("attributionText")).trim() || null,
      licenceSourceUrl: String(f.get("licenceSourceUrl")).trim(),
      provenanceKind: String(f.get("provenanceKind")) || null,
      provenanceNotes: String(f.get("provenanceNotes")).trim() || null,
      attest,
    };
    await run(
      "licence",
      () =>
        api(`/api/admin/assets/${asset.id}`, { method: "PATCH", body }).catch((err) => {
          setErrors(fieldErrors(err));
          throw err;
        }),
      attest ? "Licence saved and rights confirmed" : "Licence saved",
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate aria-label="Licence and rights">
      <fieldset disabled={readOnly} className="contents">
        <Field label="Licence" hint={chosen?.hint}>
          <Select
            name="licenceId"
            value={licenceId}
            onChange={(e) => {
              setLicenceId(e.target.value);
              // A different licence needs its rights confirmed again.
              if (e.target.value !== (asset.licenceId ?? "")) setAttest(false);
            }}
          >
            <option value="">Choose a licence…</option>
            {licences.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Attribution text"
          error={errors.attributionText}
          hint={chosen?.attribution ? "This licence requires credit. Visitors are shown this line before downloading." : "Optional for this licence."}
        >
          <Input name="attributionText" defaultValue={asset.attributionText ?? ""} maxLength={1000} placeholder="“Wooden crate” by Jane Doe, CC BY 4.0" />
        </Field>
        <Field label="Original source URL" error={errors.licenceSourceUrl} hint="Where the asset or its licence came from, if not made here.">
          <Input name="licenceSourceUrl" type="url" defaultValue={asset.licenceSourceUrl ?? ""} placeholder="https://" />
        </Field>
        <div className="grid gap-4 md:grid-cols-[1fr_2fr]">
          <Field label="Provenance">
            <Select name="provenanceKind" defaultValue={asset.provenanceKind ?? ""}>
              <option value="">Not recorded</option>
              {PROVENANCE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {PROVENANCE_LABEL[k]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Provenance notes" error={errors.provenanceNotes} hint="Who made it, with what tools, under which agreement or plan.">
            <Textarea name="provenanceNotes" defaultValue={asset.provenanceNotes ?? ""} rows={2} />
          </Field>
        </div>
        <div className="border border-dashed border-edge bg-sunken p-3">
          <Checkbox
            label="I confirm we own this asset or have the right to redistribute it under the licence above"
            description={
              asset.attestedAt && !licenceChanged
                ? `Confirmed ${formatDate(asset.attestedAt)}${asset.attestedBy ? ` by ${asset.attestedBy}` : ""}. Untick to withdraw.`
                : "Required before publishing. The confirmation is recorded with your name and the date."
            }
            checked={attest}
            disabled={readOnly || !licenceId}
            onCheckedChange={setAttest}
          />
        </div>
        {licenceChanged && asset.attestedAt ? (
          <Notice tone="warn" title="Licence changed">
            Saving a different licence clears the earlier rights confirmation. Confirm again if it still holds.
          </Notice>
        ) : null}
        <div>
          <Button type="submit" variant="primary" disabled={busy !== null || readOnly}>
            {busy === "licence" ? "Saving…" : "Save licence"}
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
