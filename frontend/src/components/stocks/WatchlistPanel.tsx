'use client';

import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import Link from 'next/link';

export interface WatchlistPanelProps {
  className?: string;
}

interface WatchlistStock {
  id: string;
  stock_id: string;
  name: string;
  close: number;
  change: number;
  changePercent: number;
}

export function WatchlistPanel({ className }: WatchlistPanelProps) {
  const [stocks, setStocks] = useState<WatchlistStock[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchWatchlist = async () => {
      try {
        const res = await fetch('/api/watchlist');
        if (!res.ok) throw new Error('Failed to fetch watchlist');
        
        const watchlistData = await res.json();
        
        if (!Array.isArray(watchlistData) || watchlistData.length === 0) {
          setStocks([]);
          setIsLoading(false);
          return;
        }

        const stockPromises = watchlistData.map(async (item: { stock_id: string; name?: string }) => {
          try {
            const historyRes = await fetch(`/api/stocks/${item.stock_id}/history?months=1`);
            if (!historyRes.ok) return null;
            
            const historyData = await historyRes.json();
            
            if (Array.isArray(historyData) && historyData.length > 0) {
              const latest = historyData[historyData.length - 1];
              const previous = historyData.length > 1 ? historyData[historyData.length - 2] : latest;

              if (!latest.close || !previous.close) return null;

              const close = latest.close;
              const change = close - previous.close;
              const changePercent = previous.close !== 0 ? (change / previous.close) * 100 : 0;
              
              return {
                id: item.stock_id,
                stock_id: item.stock_id,
                name: item.name || item.stock_id,
                close,
                change,
                changePercent,
              };
            }
          } catch (e) {
            console.error(`Failed to fetch history for ${item.stock_id}`, e);
          }
          return null;
        });

        const results = await Promise.all(stockPromises);
        const validStocks = results.filter((s): s is WatchlistStock => s !== null);
        
        // Sort by change% descending (biggest gainers first)
        validStocks.sort((a, b) => b.changePercent - a.changePercent);
        
        setStocks(validStocks);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setIsLoading(false);
      }
    };

    fetchWatchlist();
  }, []);

  return (
    <Card className={cn('w-full', className)}>
      <CardHeader>
        <CardTitle className="text-lg font-bold">自選股清單</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : error ? (
          <div className="text-sm text-red-500 text-center py-4">{error}</div>
        ) : stocks.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-muted-foreground mb-4">尚未加入自選股</p>
            <Link href="/watchlist" className="text-sm text-blue-500 hover:underline">
              前往設定
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>代碼</TableHead>
                  <TableHead>名稱</TableHead>
                  <TableHead className="text-right">收盤價</TableHead>
                  <TableHead className="text-right">漲跌</TableHead>
                  <TableHead className="text-right">漲跌幅%</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stocks.map((stock) => {
                  const isPositive = stock.change > 0;
                  const isNegative = stock.change < 0;
                  const colorClass = isPositive
                    ? 'text-red-500'
                    : isNegative
                    ? 'text-green-500'
                    : 'text-muted-foreground';

                  return (
                    <TableRow key={stock.id} className="cursor-pointer hover:bg-muted/50 transition-colors">
                      <TableCell>
                        <Link href={`/stock?symbol=${stock.stock_id}`} className="block w-full">
                          {stock.stock_id}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Link href={`/stock?symbol=${stock.stock_id}`} className="block w-full">
                          {stock.name}
                        </Link>
                      </TableCell>
                      <TableCell className={cn('text-right font-medium', colorClass)}>
                        {stock.close.toFixed(2)}
                      </TableCell>
                      <TableCell className={cn('text-right', colorClass)}>
                        {stock.change > 0 ? '+' : ''}
                        {stock.change.toFixed(2)}
                      </TableCell>
                      <TableCell className={cn('text-right', colorClass)}>
                        {stock.changePercent > 0 ? '+' : ''}
                        {stock.changePercent.toFixed(2)}%
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}