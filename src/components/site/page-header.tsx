import type { ReactNode } from "react";
import { Breadcrumbs, type Crumb } from "@/components/ui/breadcrumbs";
import { cn } from "@/lib/cn";

export interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  breadcrumbs?: Crumb[];
  actions?: ReactNode;
  className?: string;
  children?: ReactNode;
}

export function PageHeader({ title, description, breadcrumbs, actions, className, children }: PageHeaderProps) {
  return (
    <div className={cn("border-b border-rule pt-8 pb-8 sm:pt-10", className)}>
      {breadcrumbs ? <Breadcrumbs items={breadcrumbs} /> : null}
      <div className="mt-4 flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div className="max-w-3xl">
          <h1 className="type-display">{title}</h1>
          {description ? <p className="mt-3 max-w-[62ch] text-lg leading-relaxed text-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
      {children}
    </div>
  );
}

export function Container({ children, className, wide }: { children: ReactNode; className?: string; wide?: boolean }) {
  return <div className={cn("mx-auto w-full px-4 sm:px-6", wide ? "max-w-[90rem]" : "max-w-6xl", className)}>{children}</div>;
}

export function Prose({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "max-w-[68ch] text-[1.0625rem] leading-[1.65] text-fg/90",
        "[&_h2]:type-title [&_h2]:mt-12 [&_h2]:mb-3 [&_h2]:text-fg [&_h3]:type-subheading [&_h3]:mt-8 [&_h3]:mb-2 [&_h3]:text-fg",
        "[&_p]:my-4 [&_ul]:my-4 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-4 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1.5",
        "[&_a]:text-accent [&_a]:underline [&_strong]:font-[620] [&_strong]:text-fg",
        "[&_code]:rounded-xs [&_code]:bg-sunken [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.85em]",
        className,
      )}
    >
      {children}
    </div>
  );
}
