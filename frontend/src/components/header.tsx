'use client';

import { Bell, Mail, Globe, Moon, Sun, Settings, UserCog, SlidersHorizontal, Wrench, Activity, Menu, Clock, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useTheme } from 'next-themes';
import { useState, useEffect } from 'react';
import { userData } from '@/lib/mock-data'
import { useUpdateStore } from '@/lib/updater';

export function Header({ onMenuClick, title }: { onMenuClick?: () => void; title?: string }) {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const updateStore = useUpdateStore();

  useEffect(() => {
    setMounted(true);
  }, []);

  const isDark = mounted ? (theme === 'dark' || resolvedTheme === 'dark') : true;

  return (
    <header className="relative z-20 h-[60px] w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-full items-center justify-between px-4 lg:px-6">
        {/* Left side - can be used for breadcrumbs or page title */}
        <div className="flex items-center gap-2 lg:gap-4">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden h-9 w-9 mr-2"
            onClick={onMenuClick}
          >
            <Menu className="h-5 w-5" />
          </Button>
          <h1 className="text-base lg:text-lg font-semibold whitespace-nowrap overflow-hidden text-ellipsis">{title || '首頁-台股儀表板'}</h1>
        </div>

        {/* Right side - actions */}
        <div className="flex items-center gap-1 lg:gap-2">
          {/* Theme Toggle */}
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9"
            onClick={() => setTheme(isDark ? 'light' : 'dark')}
          >
            {mounted && isDark ? (
              <Sun className="h-4 w-4" />
            ) : (
              <Moon className="h-4 w-4" />
            )}
          </Button>

          {/* Settings */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-9 w-9">
                <Settings className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>系統設置</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/admin/account" className="flex items-center gap-2 cursor-pointer">
                  <UserCog className="h-4 w-4" />
                  帳號設置
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/admin/menu" className="flex items-center gap-2 cursor-pointer">
                  <SlidersHorizontal className="h-4 w-4" />
                  功能設置
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/admin/settings" className="flex items-center gap-2 cursor-pointer">
                  <Wrench className="h-4 w-4" />
                  系統參數
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/admin/schedule" className="flex items-center gap-2 cursor-pointer">
                  <Clock className="h-4 w-4" />
                  排程設置
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => updateStore.check()}
                className="flex items-center gap-2 cursor-pointer"
              >
                <RefreshCw className={'h-4 w-4 ' + (updateStore.state.phase === 'checking' ? 'animate-spin' : '')} />
                {updateStore.state.phase === 'checking' ? '檢查中...' : '檢查版本更新'}
                {updateStore.state.phase === 'available' && (
                  <span className="ml-auto text-[10px] text-primary font-medium">v{updateStore.state.version}</span>
                )}
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/admin/status" className="flex items-center gap-2 cursor-pointer">
                  <Activity className="h-4 w-4" />
                  服務狀態
                </Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Messages */}
          <Button variant="ghost" size="icon" className="relative h-9 w-9">
            <Mail className="h-4 w-4" />
            <Badge className="absolute -right-1 -top-1 h-5 w-5 rounded-full p-0 text-xs flex items-center justify-center bg-blue-500 text-white">
              3
            </Badge>
          </Button>

          {/* Notifications */}
          <Button variant="ghost" size="icon" className="relative h-9 w-9">
            <Bell className="h-4 w-4" />
            <Badge className="absolute -right-1 -top-1 h-5 w-5 rounded-full p-0 text-xs flex items-center justify-center bg-blue-500 text-white">
              7
            </Badge>
          </Button>

          {/* Language */}
          <Button variant="ghost" size="icon" className="h-9 w-9">
            <Globe className="h-4 w-4" />
          </Button>

          {/* User Avatar */}
          <Avatar className="h-8 w-8 cursor-pointer">
            <AvatarImage src={userData.avatar} />
            <AvatarFallback className="bg-purple-500 text-white text-xs">
              {userData.name
                .split(' ')
                .map((n) => n[0])
                .join('')}
            </AvatarFallback>
          </Avatar>
        </div>
      </div>
    </header>
  );
}
