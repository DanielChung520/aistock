import React from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface StockSummaryCardProps {
  stockId: string;
  name: string;
  close: number;
  change: number;
  changePercent: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  className?: string;
}

export function StockSummaryCard({
  stockId,
  name,
  close,
  change,
  changePercent,
  open,
  high,
  low,
  volume,
  className,
}: StockSummaryCardProps) {
  const isPositive = change > 0;
  const isNegative = change < 0;
  
  const colorClass = isPositive
    ? 'text-red-500'
    : isNegative
    ? 'text-green-500'
    : 'text-muted-foreground';

  const Icon = isPositive ? TrendingUp : isNegative ? TrendingDown : Minus;

  return (
    <div className={cn('w-full flex flex-col md:flex-row items-start md:items-center gap-2 md:gap-4 px-4 py-3 md:py-2 rounded-lg border border-border bg-card', className)}>
      <div className="flex flex-row md:items-center justify-between w-full md:w-auto gap-4">
        <div className="flex items-center gap-1.5 shrink-0 hidden md:flex">
          <span className="font-bold text-sm">{name}</span>
          <span className="text-muted-foreground text-xs">{stockId}</span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className={cn('text-xl font-bold', colorClass)}>{close.toFixed(2)}</span>
          <div className={cn('flex items-center text-sm font-semibold', colorClass)}>
            <Icon className="w-3.5 h-3.5 mr-0.5" />
            <span>{Math.abs(change).toFixed(2)}</span>
            <span className="ml-0.5">({Math.abs(changePercent).toFixed(2)}%)</span>
          </div>
        </div>
      </div>

      <div className="hidden md:block h-6 w-px bg-border shrink-0" />

      <div className="flex items-center gap-3 md:gap-4 text-xs flex-wrap w-full md:w-auto border-t border-border pt-2 md:border-t-0 md:pt-0">
        <div className="flex items-center gap-1">
          <span className="text-muted-foreground">開</span>
          <span className="font-medium">{open.toFixed(2)}</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-muted-foreground">高</span>
          <span className={cn("font-medium", high > close ? "text-red-500" : "")}>{high.toFixed(2)}</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-muted-foreground">低</span>
          <span className={cn("font-medium", low < close ? "text-green-500" : "")}>{low.toFixed(2)}</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-muted-foreground">量</span>
          <span className="font-medium">{volume.toLocaleString()}</span>
        </div>
      </div>
    </div>
  );
}
