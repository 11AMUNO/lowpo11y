import Link from "next/link";
import type { ReactNode } from "react";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { Container, PageHeader } from "./page-header";

/**
 * Honest holding page for a section whose milestone has not shipped yet.
 * States what will be here and links to things that already work.
 */
export function SectionPlaceholder({
  title,
  description,
  breadcrumb,
  emptyTitle,
  children,
  links = [],
}: {
  title: string;
  description: string;
  breadcrumb: string;
  emptyTitle: string;
  children: ReactNode;
  links?: { label: string; href: string }[];
}) {
  return (
    <Container wide>
      <PageHeader title={title} description={description} breadcrumbs={[{ label: "Home", href: "/" }, { label: breadcrumb }]} />
      <div className="py-6">
        <EmptyState
          title={emptyTitle}
          action={links.map((l) => (
            <Link key={l.href} href={l.href} className={buttonClasses("secondary", "md")}>
              {l.label}
            </Link>
          ))}
        >
          {children}
        </EmptyState>
      </div>
    </Container>
  );
}
