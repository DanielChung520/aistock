"use client";

import { useEffect } from "react";
import { X, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStrategyDrawer } from "@/lib/strategy-drawer-context";
import { cn } from "@/lib/utils";
import { StrategyWorkspace } from "@/components/strategy-workspace";

export function StrategyDrawer() {
  const { isOpen, close } = useStrategyDrawer();

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
          "fixed top-10 right-0 bottom-0 z-[100] w-[580px] bg-background border-l border-border shadow-2xl flex flex-col transition-transform duration-300 ease-out",
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
              <div className="text-[10px] text-muted-foreground">策略庫 / 執行記錄</div>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={close}
            title="關閉 (ESC)"
          >
            <X className="h-4 w-4" />
          </Button>
        </header>
        <div className="flex-1 overflow-y-auto">
          <StrategyWorkspace />
        </div>
      </aside>
    </>
  );
}
