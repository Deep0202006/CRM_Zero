"use client";

import { useId, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";

const query = "(min-width: 1200px)";
const subscribe = (notify: () => void) => {
  const media = window.matchMedia(query);
  media.addEventListener("change", notify);
  return () => media.removeEventListener("change", notify);
};

/** One detail tree: non-modal desktop context, existing accessible Sheet on narrow screens. */
export function ContextRail({ open, title, description, onClose, returnFocus, children }: {
  open: boolean; title: string; description: string; onClose: () => void;
  returnFocus?: RefObject<HTMLElement | null>; children: ReactNode;
}) {
  const wide = useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);
  const titleId = useId();
  const restoreFocus = () => {
    if (returnFocus?.current?.isConnected) returnFocus.current.focus();
    else document.querySelector<HTMLElement>("[data-workspace-register]")?.focus();
  };
  if (wide) return open ? <aside className="workspace-context" aria-labelledby={titleId}>
    <header className="flex items-start justify-between gap-3 border-b border-[var(--border-subtle)] p-4">
      <div className="min-w-0"><h2 id={titleId} className="break-words text-base font-semibold">{title}</h2><p className="mt-1 text-sm text-[var(--text-secondary)]">{description}</p></div>
      <Button size="sm" variant="ghost" onClick={() => { onClose(); restoreFocus(); }}>Close</Button>
    </header><div className="space-y-4 p-4 text-sm">{children}</div>
  </aside> : null;
  return <Sheet open={open} onOpenChange={(value) => { if (!value) onClose(); }}>
    <SheetContent onCloseAutoFocus={(event) => { event.preventDefault(); restoreFocus(); }}>
      <SheetHeader className="pr-14"><SheetTitle>{title}</SheetTitle><SheetDescription>{description}</SheetDescription></SheetHeader>
      <div className="space-y-4 px-4 pb-6 text-sm">{children}</div>
    </SheetContent>
  </Sheet>;
}
