import { Badge } from "@/components/ui/badge";

const LABEL = { draft: "Draft", review: "In review", published: "Published", archived: "Archived" } as const;

export function StatusBadge({ status }: { status: keyof typeof LABEL }) {
  return <Badge tone={status === "published" ? "bright" : status === "review" ? "outline" : "neutral"}>{LABEL[status]}</Badge>;
}
