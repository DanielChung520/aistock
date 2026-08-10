"use client";

import { useState, useEffect, useCallback } from "react";
import { X, Bell, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useNotificationsDrawer } from "@/lib/notifications-drawer-context";
import { useStockTabs } from "@/lib/stock-tab-context";
import { cn } from "@/lib/utils";

interface HitCondition {
  metric: string;
  op: string;
  value: number | string | null;
  note: string;
}

interface HitItem {
  _key: string;
  stock_id: string;
  name: string;
  condition_name?: string;
  conditions?: HitCondition[];
  scope: string;
  hit_values?: Record<string, unknown>;
  price?: number;
  source: "manual" | "ai";
  scan_at: number;
  read: boolean;
}

const PAGE_SIZE = 50;

function dateKey(ts: number): string | null {
  if (!Number.isFinite(ts)) return null;
  const d = new Date(ts * 1000);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function groupLabel(key: string): string {
  const now = new Date();
  const todayKey = now.toISOString().slice(0, 10);
  if (key === todayKey) return `今天 ${key}`;
  const yesterdayKey = new Date(now.getTime() - 86400000)
    .toISOString()
    .slice(0, 10);
  if (key === yesterdayKey) return `昨天 ${key}`;
  return key;
}

function timeLabel(ts: number): string {
  if (!Number.isFinite(ts)) return "";
  const d = new Date(ts * 1000);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function conditionSummary(hit: HitItem): string {
  if (hit.condition_name) return hit.condition_name;
  if (hit.conditions && hit.conditions.length > 0) {
    return hit.conditions
      .map((c) => c.note || c.metric)
      .filter(Boolean)
      .join(" + ");
  }
  if (hit.scope === "watchlist") return "關注股";
  if (hit.scope === "all") return "全部";
  return hit.scope;
}

export function NotificationsDrawer() {
  const { isOpen, close } = useNotificationsDrawer();
  const { openTab } = useStockTabs();
  const [hits, setHits] = useState<HitItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [before, setBefore] = useState<number | null>(null);

  const fetchHits = useCallback(
    async (beforeTs: number | null, append: boolean) => {
      setIsLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          limit: String(PAGE_SIZE),
          unread_first: "true",
        });
        if (beforeTs !== null && beforeTs !== undefined) {
          params.set("before", String(beforeTs));
        }
        const res = await fetch(`/api/strategy-hits?${params.toString()}`);
        if (!res.ok) throw new Error(`載入通知失敗 (${res.status})`);
        const data = (await res.json()) as { results?: HitItem[] };
        const results = data.results ?? [];
        setHits((prev) => (append ? [...prev, ...results] : results));
        setHasMore(results.length === PAGE_SIZE);
        if (results.length > 0) {
          setBefore(results[results.length - 1].scan_at);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  // 開屜時重抓（reset pagination）
  useEffect(() => {
    if (!isOpen) return;
    setBefore(null);
    void fetchHits(null, false);
  }, [isOpen, fetchHits]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    if (isOpen) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, close]);

  const loadMore = () => {
    if (before === null || before === undefined) return;
    void fetchHits(before, true);
  };

  const markRead = async (key: string) => {
    // optimistic update
    setHits((prev) =>
      prev.map((h) => (h._key === key ? { ...h, read: true } : h)),
    );
    try {
      await fetch(`/api/strategy-hits/${key}/read`, { method: "PUT" });
    } catch (e) {
      console.error("Failed to mark hit as read:", e);
    }
  };

  const markAllRead = async () => {
    try {
      await fetch("/api/strategy-hits/read-all", { method: "PUT" });
      setHits((prev) => prev.map((h) => ({ ...h, read: true })));
    } catch (e) {
      console.error("Failed to mark all hits as read:", e);
    }
  };

  const handleClickHit = (hit: HitItem) => {
    openTab(hit.stock_id, hit.name);
    close();
    if (!hit.read) void markRead(hit._key);
  };

  const groups = hits.reduce(
    (acc, h) => {
      const key = dateKey(h.scan_at);
      if (key === null) return acc;
      (acc[key] ??= []).push(h);
      return acc;
    },
    {} as Record<string, HitItem[]>,
  );

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
            <div className="h-8 w-8 rounded-md bg-red-500 flex items-center justify-center">
              <Bell className="h-4 w-4 text-white" />
            </div>
            <div>
              <div className="text-sm font-semibold">通知中心</div>
              <div className="text-[10px] text-muted-foreground">
                策略命中記錄
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs"
              onClick={() => void markAllRead()}
            >
              <Check className="h-3.5 w-3.5 mr-1" />
              全部標已讀
            </Button>
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
          {error ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6">
              <div className="text-sm text-destructive">{error}</div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void fetchHits(null, false)}
              >
                重試
              </Button>
            </div>
          ) : isLoading && hits.length === 0 ? (
            <div className="flex-1 p-4 space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-start gap-3">
                  <Skeleton className="mt-1 h-3 w-3 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : hits.length === 0 ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-sm text-muted-foreground">尚無通知</div>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto">
              {Object.entries(groups).map(([date, items]) => (
                <div key={date}>
                  <div className="sticky top-0 z-10 bg-background/95 backdrop-blur px-4 py-2 text-xs font-semibold text-muted-foreground border-b border-border">
                    {groupLabel(date)}
                  </div>
                  {items.map((h) => (
                    <button
                      key={h._key}
                      onClick={() => handleClickHit(h)}
                      className="w-full text-left px-4 py-3 border-b border-border hover:bg-accent/50 transition-colors flex items-start gap-3"
                    >
                      <span
                        className={cn(
                          "mt-1 text-sm leading-none shrink-0",
                          h.read ? "text-muted-foreground/50" : "text-red-500",
                        )}
                      >
                        {h.read ? "○" : "●"}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={cn(
                              "text-sm font-medium truncate",
                              h.read
                                ? "text-muted-foreground"
                                : "text-foreground",
                            )}
                          >
                            {h.stock_id} {h.name}
                          </span>
                          <span className="text-[10px] text-muted-foreground shrink-0">
                            {timeLabel(h.scan_at)}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground truncate mt-0.5">
                          {conditionSummary(h)}
                        </div>
                        {h.price !== undefined && h.price !== null && (
                          <div className="text-xs text-muted-foreground mt-0.5">
                            收盤 {h.price}
                          </div>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
          {hasMore && !error && (
            <div className="p-3 border-t border-border shrink-0">
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={loadMore}
                disabled={isLoading}
              >
                {isLoading ? "載入中..." : "載入更多"}
              </Button>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
