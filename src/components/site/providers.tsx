"use client";

import type { ReactNode } from "react";
import { Toaster } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { UsageBeacon } from "./usage-beacon";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider delayDuration={350}>
      {children}
      <Toaster />
      <UsageBeacon />
    </TooltipProvider>
  );
}
