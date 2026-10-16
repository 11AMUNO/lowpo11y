import { SiteHeader } from "@/components/site/site-header";

/** Full-height workspace chrome for tools, the Workshop and the Scene Builder: no footer. */
export default function StudioLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <SiteHeader compact />
      <main id="main" className="flex min-h-0 flex-1 flex-col">
        {children}
      </main>
    </div>
  );
}
