import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="lp-scroll w-full overflow-x-auto border border-rule-strong">
      <table className={cn("w-full border-collapse text-[13px]", className)} {...props} />
    </div>
  );
}

export function THead(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className="bg-panel text-left" {...props} />;
}

export function TBody(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className="[&_tr]:border-t [&_tr]:border-rule [&_tr:hover]:bg-hover" {...props} />;
}

export function Th({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return <th scope="col" className={cn("type-label h-9 px-3 font-normal whitespace-nowrap", className)} {...props} />;
}

export function Td({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("px-3 py-2 align-middle", className)} {...props} />;
}
