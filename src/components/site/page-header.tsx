import type { ReactNode } from "react";
import { Breadcrumbs, type Crumb } from "@/components/ui/breadcrumbs";
import { cn } from "@/lib/cn";

export interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  breadcrumbs?: Crumb[];
  actions?: ReactNode;
  /** Telemetry line, e.g. "11 TEXTURES // FILTERED BY METAL". Rendered after a ">" prompt. */
  telemetry?: ReactNode;
  className?: string;
  children?: ReactNode;
}

/** Page title block in the Seamless header idiom: OCR title with glow, then a telemetry line. */
export function PageHeader({ title, description, breadcrumbs, actions, telemetry, className, children }: PageHeaderProps) {
  return (
    <div className={cn("border-b border-rule-strong pt-6 pb-6 sm:pt-8", className)}>
      {breadcrumbs ? <Breadcrumbs items={breadcrumbs} /> : null}
      <div className="mt-4 flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div className="max-w-3xl">
          <h1 className="type-display">{title}</h1>
          {description ? <p className="mt-3 max-w-[70ch] text-[15px] leading-relaxed text-fg/85">{description}</p> : null}
          {telemetry ? (
            <p className="mt-3 font-ocr text-[13px] tracking-[0.08em] text-muted uppercase">
              &gt; {telemetry}
              <span className="lp-cursor" aria-hidden />
            </p>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
      {children}
    </div>
  );
}

export function Container({ children, className, wide }: { children: ReactNode; className?: string; wide?: boolean }) {
  return <div className={cn("mx-auto w-full px-4 sm:px-6", wide ? "max-w-[105rem]" : "max-w-6xl", className)}>{children}</div>;
}

export function Prose({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "max-w-[74ch] text-[15px] leading-[1.7] text-fg/90",
        "[&_h2]:type-title [&_h2]:mt-10 [&_h2]:mb-3 [&_h2]:before:content-['//_'] [&_h2]:before:text-muted",
        "[&_h3]:type-heading [&_h3]:mt-7 [&_h3]:mb-2",
        "[&_p]:my-4 [&_ul]:my-4 [&_ul]:list-['>_'] [&_ul]:pl-5 [&_ol]:my-4 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1.5 [&_li]:pl-1 [&_li::marker]:text-muted",
        "[&_a]:text-bright [&_a]:underline [&_strong]:font-medium [&_strong]:text-bright",
        "[&_code]:border [&_code]:border-rule-strong [&_code]:bg-sunken [&_code]:px-1 [&_code]:text-[0.9em]",
        "[&_pre]:my-4 [&_pre]:border [&_pre]:border-rule-strong [&_pre]:bg-sunken [&_pre]:p-3 [&_pre]:text-[13px] [&_pre]:leading-snug [&_pre]:break-words [&_pre]:whitespace-pre-wrap [&_pre_code]:border-0 [&_pre_code]:bg-transparent [&_pre_code]:p-0",
        className,
      )}
    >
      {children}
    </div>
  );
}
