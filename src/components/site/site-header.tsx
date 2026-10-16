"use client";

import { Dialog as RDialog, NavigationMenu } from "radix-ui";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { TOOLS, TOOL_CATEGORY_LABEL, type ToolCategory } from "@/features/tools/registry";
import { CrtToggle } from "./crt-toggle";
import { Wordmark } from "./logo";
import { PRIMARY_NAV } from "./nav";
import { SearchCommand } from "./search-command";

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

const linkClass =
  "relative flex h-12 cursor-pointer items-center px-2.5 font-ocr text-[12.5px] tracking-[0.1em] text-muted uppercase transition-colors hover:text-bright " +
  "data-[active=true]:text-bright data-[active=true]:[text-shadow:var(--crt-glow)] data-[active=true]:after:absolute data-[active=true]:after:inset-x-2.5 " +
  "data-[active=true]:after:bottom-0 data-[active=true]:after:h-px data-[active=true]:after:bg-bright data-[active=true]:after:shadow-[var(--crt-glow)]";

function ToolsPanel() {
  const groups = TOOLS.reduce<Record<string, typeof TOOLS>>((acc, t) => {
    (acc[t.category] ??= []).push(t);
    return acc;
  }, {});
  return (
    <div className="grid w-[min(46rem,calc(100vw-2rem))] grid-cols-2 gap-x-6 gap-y-4 p-4">
      {Object.entries(groups).map(([cat, tools]) => (
        <div key={cat}>
          <p className="type-panel mb-1.5">// {TOOL_CATEGORY_LABEL[cat as ToolCategory]}</p>
          <ul className="flex flex-col">
            {tools.map((t) => (
              <li key={t.slug}>
                {t.status === "available" ? (
                  <NavigationMenu.Link asChild>
                    <Link href={t.route} className="-mx-2 block border-l-2 border-transparent px-2 py-1.5 hover:border-bright hover:bg-hover">
                      <span className="block font-ocr text-[13px] tracking-[0.06em] uppercase glow">{t.name}</span>
                      <span className="line-clamp-1 text-xs text-muted">{t.summary}</span>
                    </Link>
                  </NavigationMenu.Link>
                ) : (
                  <div className="-mx-2 px-2 py-1.5">
                    <span className="block font-ocr text-[13px] tracking-[0.06em] text-muted uppercase">
                      {t.name} <span className="text-[11px]">// in development</span>
                    </span>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
      <div className="col-span-2 flex items-center justify-between border-t border-dashed border-rule-strong pt-3">
        <NavigationMenu.Link asChild>
          <Link href="/tools" className="font-ocr text-xs tracking-[0.1em] uppercase glow hover:underline">
            [ All tools ]
          </Link>
        </NavigationMenu.Link>
        <NavigationMenu.Link asChild>
          <Link href="/workshop" className="font-ocr text-[11px] tracking-[0.06em] text-muted uppercase hover:text-bright">
            Chain tools into a pipeline in the workshop
          </Link>
        </NavigationMenu.Link>
      </div>
    </div>
  );
}

function MobileMenu({ pathname }: { pathname: string }) {
  const [open, setOpen] = useState(false);
  return (
    <RDialog.Root open={open} onOpenChange={setOpen}>
      <RDialog.Trigger
        className="h-8 cursor-pointer border border-edge bg-sunken px-2.5 font-ocr text-xs tracking-[0.1em] text-muted uppercase hover:text-bright lg:hidden"
        aria-label="Open menu"
      >
        Menu
      </RDialog.Trigger>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-50 bg-scrim" />
        <RDialog.Content className="fixed top-0 right-0 z-50 flex h-dvh w-[min(22rem,100vw)] flex-col border-l border-rule-strong bg-panel focus:outline-none data-[state=open]:animate-[lp-slide-in_160ms_ease-out]">
          <div className="flex h-12 items-center justify-between border-b border-rule-strong px-4">
            <RDialog.Title asChild>
              <span>
                <Wordmark />
              </span>
            </RDialog.Title>
            <RDialog.Description className="sr-only">Site navigation</RDialog.Description>
            <RDialog.Close className="cursor-pointer px-1 font-ocr text-lg text-muted hover:text-bright" aria-label="Close menu">
              ×
            </RDialog.Close>
          </div>
          <nav aria-label="Primary" className="lp-scroll flex-1 overflow-y-auto p-2">
            <ul>
              {PRIMARY_NAV.map((n) => (
                <li key={n.href}>
                  <Link
                    href={n.href}
                    onClick={() => setOpen(false)}
                    aria-current={isActive(pathname, n.href) ? "page" : undefined}
                    className="block border-l-2 border-transparent px-3 py-2.5 hover:bg-hover aria-[current=page]:border-bright aria-[current=page]:bg-hover"
                  >
                    <span className="block font-ocr text-[13px] tracking-[0.1em] uppercase glow">{n.label}</span>
                    <span className="text-xs text-muted">{n.description}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div className="flex items-center justify-between border-t border-rule-strong px-4 py-3">
            <span className="type-label">Display</span>
            <CrtToggle />
          </div>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

export function SiteHeader({ compact = false }: { compact?: boolean }) {
  const pathname = usePathname() ?? "/";
  return (
    <header className="sticky top-0 z-40 border-b border-rule-strong bg-bg">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:border focus:border-bright focus:bg-bg focus:px-3 focus:py-2 focus:font-ocr focus:text-bright focus:uppercase"
      >
        Skip to content
      </a>
      <div className={cn("mx-auto flex h-12 items-center gap-4 px-4 sm:px-6", compact ? "max-w-none" : "max-w-[105rem]")}>
        <Link href="/" className="shrink-0" aria-label="LOWPO11Y home">
          <Wordmark />
        </Link>

        <NavigationMenu.Root className="relative hidden lg:block" aria-label="Primary">
          <NavigationMenu.List className="flex items-center">
            {PRIMARY_NAV.map((n) =>
              n.href === "/tools" ? (
                <NavigationMenu.Item key={n.href}>
                  <NavigationMenu.Trigger data-active={isActive(pathname, n.href)} className={cn(linkClass, "gap-1 [&[data-state=open]>span]:rotate-180")}>
                    {n.label}
                    <span aria-hidden className="inline-block text-[10px] transition-transform duration-150">
                      ▾
                    </span>
                  </NavigationMenu.Trigger>
                  <NavigationMenu.Content className="absolute top-0 left-0">
                    <ToolsPanel />
                  </NavigationMenu.Content>
                </NavigationMenu.Item>
              ) : (
                <NavigationMenu.Item key={n.href}>
                  <NavigationMenu.Link asChild active={isActive(pathname, n.href)}>
                    <Link href={n.href} data-active={isActive(pathname, n.href)} className={linkClass}>
                      {n.label}
                    </Link>
                  </NavigationMenu.Link>
                </NavigationMenu.Item>
              ),
            )}
          </NavigationMenu.List>
          <div className="absolute top-full left-0">
            <NavigationMenu.Viewport className="relative mt-px h-[var(--radix-navigation-menu-viewport-height)] w-[var(--radix-navigation-menu-viewport-width)] overflow-hidden border border-t-0 border-rule-strong bg-panel" />
          </div>
        </NavigationMenu.Root>

        <div className="ml-auto flex items-center gap-2">
          <SearchCommand />
          <CrtToggle className="hidden lg:flex" />
          <MobileMenu pathname={pathname} />
        </div>
      </div>
    </header>
  );
}
