import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { MessageActions } from "@/features/admin/messages/message-actions";
import { listMessages, type ContactMessage } from "@/lib/assets/admin";
import { contextFor, requireStaffPage } from "@/lib/auth/server";
import { withDb } from "@/lib/db";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/format";

export const metadata = { title: "Messages" };

const KIND: Record<ContactMessage["kind"], string> = { general: "Question", takedown: "Takedown", correction: "Correction", suggestion: "Suggestion" };
const STATUS: Record<ContactMessage["status"], string> = { new: "New", in_progress: "In progress", resolved: "Resolved" };

export default async function MessagesPage({ searchParams }: PageProps<"/admin/messages">) {
  const user = await requireStaffPage("/admin/messages");
  const sp = await searchParams;
  const status = (["new", "in_progress", "resolved"] as const).find((s) => s === sp.status);
  const messages = await withDb(contextFor(user), (q) => listMessages(q, status));
  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="type-display">Messages</h1>
      <p className="mt-2 font-ocr text-[13px] tracking-[0.08em] text-muted uppercase">&gt; contact form // takedowns first</p>
      <nav aria-label="Filter messages" className="mt-5 flex flex-wrap gap-1.5">
        {[undefined, "new", "in_progress", "resolved"].map((s) => (
          <Link
            key={s ?? "all"}
            href={s ? `/admin/messages?status=${s}` : "/admin/messages"}
            aria-current={status === s ? "page" : undefined}
            className={cn(buttonClasses("secondary", "sm"), status === s && "border-bright text-bright")}
          >
            {s ? STATUS[s as ContactMessage["status"]] : "All"}
          </Link>
        ))}
      </nav>
      <div className="mt-4 flex flex-col gap-3">
        {messages.length ? (
          [...messages]
            .sort((a, b) => Number(b.kind === "takedown" && b.status !== "resolved") - Number(a.kind === "takedown" && a.status !== "resolved"))
            .map((m) => (
              <article key={m.id} className={cn("border bg-panel p-3.5", m.kind === "takedown" && m.status !== "resolved" ? "border-bright" : "border-rule-strong")}>
                <header className="flex flex-wrap items-center gap-2">
                  <Badge tone={m.kind === "takedown" ? "bright" : "neutral"}>{KIND[m.kind]}</Badge>
                  <Badge tone="outline">{STATUS[m.status]}</Badge>
                  <h2 className="text-[14px] text-fg">{m.subject}</h2>
                  <span className="ml-auto font-ocr text-[11px] text-muted">{formatDate(m.created_at)}</span>
                </header>
                <p className="mt-1 font-ocr text-[11px] tracking-[0.04em] text-muted">
                  {m.name} //{" "}
                  <a href={`mailto:${m.email}?subject=${encodeURIComponent(`Re: ${m.subject}`)}`} className="text-bright underline underline-offset-2">
                    {m.email}
                  </a>
                  {m.page_url ? (
                    <>
                      {" "}
                      //{" "}
                      <a href={m.page_url} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-bright">
                        {m.page_url}
                      </a>
                    </>
                  ) : null}
                </p>
                <p className="mt-2 text-[13.5px] leading-relaxed whitespace-pre-wrap text-fg/90">{m.message}</p>
                <div className="mt-3">
                  <MessageActions id={m.id} status={m.status} />
                </div>
              </article>
            ))
        ) : (
          <EmptyState title="No messages">
            <p>Messages sent from the contact page appear here.</p>
          </EmptyState>
        )}
      </div>
    </div>
  );
}
