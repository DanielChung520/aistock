"use client";

import { Bell } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip";
import { useNotificationsDrawer } from "@/lib/notifications-drawer-context";
import { useUnreadCount } from "@/hooks/use-unread-count";
import { cn } from "@/lib/utils";

export function NotificationsIconButton({ className }: { className?: string }) {
  const { open } = useNotificationsDrawer();
  const { unread } = useUnreadCount();
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={open}
            className={cn(
              "relative h-[45px] w-[45px] rounded-lg flex items-center justify-center transition-all",
              "bg-red-500/90 text-white shadow-sm",
              "hover:bg-red-500 hover:shadow-md hover:scale-105 active:scale-95",
              className,
            )}
            title="通知中心"
          >
            <Bell className="h-[25px] w-[25px]" />
            {unread > 0 && (
              <span className="absolute -right-1 -top-1 h-5 w-5 rounded-full p-0 text-xs flex items-center justify-center bg-red-600 text-white border border-white/30">
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="left">通知中心</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
