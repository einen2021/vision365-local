"use client";

import { useEffect, useRef } from "react";
import { AlertTriangle, Bot, CheckCircle2, Eye, Flame, X, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAutoPilotStore } from "@/stores/autoPilotStore";

const TONE_META = {
  fire: { icon: Flame, className: "border-red-500/50 bg-red-950/90 text-red-50", iconClass: "text-red-400" },
  trouble: {
    icon: AlertTriangle,
    className: "border-yellow-500/50 bg-yellow-950/90 text-yellow-50",
    iconClass: "text-yellow-400",
  },
  supervisory: {
    icon: Eye,
    className: "border-purple-500/50 bg-purple-950/90 text-purple-50",
    iconClass: "text-purple-400",
  },
  success: {
    icon: CheckCircle2,
    className: "border-green-500/50 bg-green-950/90 text-green-50",
    iconClass: "text-green-400",
  },
  error: { icon: XCircle, className: "border-red-500/60 bg-zinc-950/95 text-red-100", iconClass: "text-red-400" },
};

/**
 * Bottom-left stack of AutoPilot notices — each dismissible, the stack
 * scrolls, with a "Dismiss all" button at the bottom.
 */
export function AutoPilotNotices() {
  const notices = useAutoPilotStore((s) => s.notices);
  const dismissNotice = useAutoPilotStore((s) => s.dismissNotice);
  const dismissAllNotices = useAutoPilotStore((s) => s.dismissAllNotices);
  const listRef = useRef(null);

  // Keep the newest notice in view.
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [notices.length]);

  if (notices.length === 0) return null;

  return (
    <div
      className="fixed bottom-4 left-4 z-[100] flex w-[340px] max-w-[calc(100vw-2rem)] flex-col gap-2 rounded-lg border bg-background/95 p-2 shadow-2xl backdrop-blur"
      role="region"
      aria-label="AutoPilot notifications"
    >
      <div className="flex items-center gap-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Bot className="h-3.5 w-3.5" />
        AutoPilot
        <span className="ml-auto font-mono tabular-nums">{notices.length}</span>
      </div>

      <ol ref={listRef} className="flex max-h-[55vh] flex-col gap-2 overflow-y-auto pr-1">
        {notices.map((notice) => {
          const meta = TONE_META[notice.tone] || TONE_META.success;
          const Icon = meta.icon;
          return (
            <li
              key={notice.id}
              className={cn(
                "relative flex items-start gap-2 rounded-md border px-3 py-2 pr-8 text-sm shadow animate-in fade-in slide-in-from-left-2 duration-200",
                meta.className,
              )}
            >
              <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", meta.iconClass)} />
              <div className="min-w-0">
                <p className="font-semibold leading-snug">{notice.title}</p>
                {notice.description ? (
                  <p className="break-words text-xs opacity-90">{notice.description}</p>
                ) : null}
                <p className="mt-0.5 text-[10px] opacity-60">
                  {new Date(notice.at).toLocaleTimeString()}
                </p>
              </div>
              <button
                type="button"
                className="absolute right-1.5 top-1.5 rounded p-0.5 opacity-70 hover:bg-white/10 hover:opacity-100"
                onClick={() => dismissNotice(notice.id)}
                aria-label="Dismiss notification"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          );
        })}
      </ol>

      <Button variant="outline" size="sm" className="w-full" onClick={dismissAllNotices}>
        Dismiss all
      </Button>
    </div>
  );
}
