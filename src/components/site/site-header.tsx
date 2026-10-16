"use client";

import { Dialog as RDialog, NavigationMenu } from "radix-ui";
import { ChevronDown, Menu as MenuIcon, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { TOOLS, TOOL_CATEGORY_LABEL, type ToolCategory } from "@/features/tools/registry";
import { Wordmark } from "./logo";
import { PRIMARY_NAV } from "./nav";
import { SearchCommand } from "./search-command";
import { ThemeToggle } from "./theme-toggle";

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

const linkClass =
  "relative flex h-14 items-center px-2.5 text-[0.875rem] text-muted transition-colors hover:text-fg " +
  "data-[active=true]:text-fg data-[active=true]:after:absolute data-[active=true]:after:inset-x-2.5 " +
  "data-[active=true]:after:bottom-0 data-[active=true]:after:h-0.5 data-[active=true]:after:bg-accent";

function ToolsPanel() {
  const groups = TOOLS.reduce<Record<string, typeof TOOLS>>((acc, t) => {
    (acc[t.category] ??= []).push(t);
    return acc;
  }, {});
  return (
    <div className="grid w-[min(44rem,calc(100vw-2rem))] grid-cols-2 gap-x-6 gap-y-4 p-5">
      {Object.entries(groups).map(([cat, tools]) => (
        <div key={cat}>
          <p className="type-small mb-1.5 text-muted">{TOOL_CATEGORY_LABEL[cat as ToolCategory]}</p>
          <ul className="flex flex-col">
            {tools.map((t) => (
              <li key={t.slug}>
                {t.status === "available" ? (
                  <NavigationMenu.Link asChild>
                    <Link href={t.route} className="-mx-2 block rounded-sm px-2 py-1.5 hover:bg-panel-2">
                      <span className="type-label block text-fg">{t.name}</span>
                      <span className="type-small line-clamp-1 text-muted">{t.summary}</span>
                    </Link>
                  </NavigationMenu.Link>
                ) : (
                  <div className="-mx-2 px-2 py-1.5">
                    <span className="type-label block text-muted">
                      {t.name} <span className="type-small text-muted">in development</span>
                    </span>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
      <div className="col-span-2 flex items-center justify-between border-t border-rule pt-3">
        <NavigationMenu.Link asChild>
          <Link href="/tools" className="type-label text-accent hover:underline">
            All tools
          </Link>
        </NavigationMenu.Link>
        <NavigationMenu.Link asChild>
          <Link href="/workshop" className="type-small text-muted hover:text-fg">
            Chain tools into a reusable pipeline in the Workshop
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
        className="grid size-8 place-items-center rounded-sm text-fg hover:bg-panel-2 lg:hidden"
        aria-label="Open menu"
      >
        <MenuIcon className="size-5" />
      </RDialog.Trigger>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-50 bg-scrim" />
        <RDialog.Content className="fixed top-0 right-0 z-50 flex h-dvh w-[min(22rem,100vw)] flex-col border-l border-rule-strong bg-panel focus:outline-none data-[state=open]:animate-[lp-slide-in_160ms_ease-out]">
          <div className="flex h-14 items-center justify-between border-b border-rule px-4">
            <RDialog.Title asChild>
              <span>
                <Wordmark />
              </span>
            </RDialog.Title>
            <RDialog.Description className="sr-only">Site navigation</RDialog.Description>
            <RDialog.Close className="grid size-8 place-items-center rounded-sm text-muted hover:bg-panel-2 hover:text-fg" aria-label="Close menu">
              <X className="size-4" />
            </RDialog.Close>
          </div>
          <nav aria-label="Primary" className="flex-1 overflow-y-auto p-2">
            <ul>
              {PRIMARY_NAV.map((n) => (
                <li key={n.href}>
                  <Link
                    href={n.href}
                    onClick={() => setOpen(false)}
                    aria-current={isActive(pathname, n.href) ? "page" : undefined}
                    className="block rounded-sm px-3 py-2.5 hover:bg-panel-2 aria-[current=page]:bg-accent-soft"
                  >
                    <span className="type-label block text-fg">{n.label}</span>
                    <span className="type-small text-muted">{n.description}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div className="flex items-center justify-between border-t border-rule px-4 py-3">
            <span className="type-small text-muted">Theme</span>
            <ThemeToggle />
          </div>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

export function SiteHeader({ compact = false }: { compact?: boolean }) {
  const pathname = usePathname() ?? "/";
  return (
    <header className="sticky top-0 z-40 border-b border-rule bg-bg/95 backdrop-blur-sm supports-[backdrop-filter]:bg-bg/85">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-sm focus:bg-accent focus:px-3 focus:py-2 focus:text-accent-ink"
      >
        Skip to content
      </a>
      <div className={cn("mx-auto flex h-14 items-center gap-4 px-4 sm:px-6", compact ? "max-w-none" : "max-w-[90rem]")}>
        <Link href="/" className="shrink-0 rounded-sm text-fg" aria-label="LOWPO11Y home">
          <Wordmark />
        </Link>

        <NavigationMenu.Root className="relative hidden lg:block" aria-label="Primary">
          <NavigationMenu.List className="flex items-center">
            {PRIMARY_NAV.map((n) =>
              n.href === "/tools" ? (
                <NavigationMenu.Item key={n.href}>
                  <NavigationMenu.Trigger
                    data-active={isActive(pathname, n.href)}
                    className={cn(linkClass, "gap-1 [&[data-state=open]>svg]:rotate-180")}
                  >
                    {n.label}
                    <ChevronDown className="size-3.5 transition-transform duration-150" aria-hidden />
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
            <NavigationMenu.Viewport className="relative mt-px h-[var(--radix-navigation-menu-viewport-height)] w-[var(--radix-navigation-menu-viewport-width)] overflow-hidden rounded-b-md border border-t-0 border-rule-strong bg-panel" />
          </div>
        </NavigationMenu.Root>

        <div className="ml-auto flex items-center gap-1.5">
          <SearchCommand />
          <div className="hidden lg:block">
            <ThemeToggle />
          </div>
          <MobileMenu pathname={pathname} />
        </div>
      </div>
    </header>
  );
}
