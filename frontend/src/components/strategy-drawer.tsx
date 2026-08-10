"use client";

import { useState, useEffect } from "react";
import { X, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useStrategyDrawer } from "@/lib/strategy-drawer-context";
import { cn } from "@/lib/utils";
import {
  ScreenResponse,
  StrategyScreener,
} from "@/components/strategy-screener";

// Select 只會產生這三種值（全部 / 關注股 / sector:*），縮窄後傳給 StrategyScreener 的 ScopeType prop
type DrawerScope = "all" | "watchlist" | `sector:${string}`;

export function StrategyDrawer() {
  const { isOpen, close } = useStrategyDrawer();
  const [scope, setScope] = useState<string>("all");
  const [industries, setIndustries] = useState<
    Array<{ industry: string; count: number }>
  >([]);

  useEffect(() => {
    if (!isOpen) return;
    fetch("/api/strategy/industries")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.statusText)))
      .then((d) => setIndustries(d.industries ?? []))
      .catch((e) => console.error("Failed to load industries:", e));
  }, [isOpen]);

  const persistHits = async (
    response: ScreenResponse,
    source: "manual" | "ai",
  ) => {
    const hits = response.results ?? [];
    if (hits.length === 0) return;
    try {
      await fetch("/api/strategy-hits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scan_id: `scan_${Date.now()}_${crypto.randomUUID()}`,
          scope,
          source,
          conditions: response.conditions ?? [],
          hits,
        }),
      });
    } catch (e) {
      console.error("Failed to persist strategy hits:", e);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    if (isOpen) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, close]);

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 z-[99] bg-black/30 animate-in fade-in-0"
          onClick={close}
        />
      )}
      <aside
        className={cn(
          "fixed top-10 right-0 bottom-0 z-[100] w-[450px] bg-background border-l border-border shadow-2xl flex flex-col transition-transform duration-300 ease-out",
          isOpen ? "translate-x-0" : "translate-x-full",
        )}
      >
        <header className="h-[60px] shrink-0 border-b border-border flex items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-md bg-blue-500 flex items-center justify-center">
              <TrendingUp className="h-4 w-4 text-white" />
            </div>
            <div>
              <div className="text-sm font-semibold">策略選股</div>
              <div className="text-[10px] text-muted-foreground">
                條件/策略掃描
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Select value={scope} onValueChange={setScope}>
              <SelectTrigger className="h-7 w-[110px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部</SelectItem>
                <SelectItem value="watchlist">關注股</SelectItem>
                {industries.map((i) => (
                  <SelectItem key={i.industry} value={`sector:${i.industry}`}>
                    {i.industry}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={close}
              title="關閉 (ESC)"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </header>
        <div className="flex-1 overflow-hidden flex flex-col">
          <div className="flex-1 overflow-y-auto">
            <StrategyScreener
              scope={scope as DrawerScope}
              onHit={persistHits}
            />
          </div>
        </div>
      </aside>
    </>
  );
}
