import { z } from "@/lib/zod";
import type { Queryable } from "@/lib/db";

export const CONTACT_KINDS = ["general", "takedown", "correction", "suggestion"] as const;

export const contactSchema = z.object({
  kind: z.enum(CONTACT_KINDS).default("general"),
  name: z.string().trim().min(1, "Tell us your name.").max(80),
  email: z.email("Enter an email address we can reply to.").max(200),
  subject: z.string().trim().min(3, "Add a subject.").max(140),
  message: z.string().trim().min(10, "Write at least a sentence.").max(5000),
  /** Site path the message is about, e.g. /assets/wooden-crate. */
  pagePath: z
    .string()
    .trim()
    .max(300)
    // One leading slash only: "//host/..." would be a link to another site.
    .regex(/^\/(?!\/)[\w\-./?=&%]*$/, "Use a path on this site, e.g. /assets/wooden-crate.")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  /** Honeypot: people never see or fill this field. */
  website: z.string().max(0).optional().or(z.string().transform(() => "bot")),
});
export type ContactInput = z.infer<typeof contactSchema>;

/** Service context: contact_messages has no public insert policy. */
export async function saveContactMessage(q: Queryable, input: ContactInput): Promise<string> {
  const [row] = await q.query<{ id: string }>(
    "insert into contact_messages (kind, name, email, subject, message, page_url) values ($1, $2, $3, $4, $5, $6) returning id",
    [input.kind, input.name, input.email, input.subject, input.message, input.pagePath ?? null],
  );
  return row!.id;
}
