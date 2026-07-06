import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { CheckCircle2, XCircle } from 'lucide-react';

export interface BestFourPointCardProps {
  stockId: string;
  bestFourPoint: {
    signal: 'buy' | 'sell' | 'neutral';
    reason: string;
  };
  buyAnalysis: {
    triggered: boolean;
    reason: string;
  };
  sellAnalysis: {
    triggered: boolean;
    reason: string;
  };
  className?: string;
}

export function BestFourPointCard({
  stockId,
  bestFourPoint,
  buyAnalysis,
  sellAnalysis,
  className,
}: BestFourPointCardProps) {
  const signalColors = {
    buy: 'bg-red-500 hover:bg-red-600 text-white',
    sell: 'bg-green-500 hover:bg-green-600 text-white',
    neutral: 'bg-gray-500 hover:bg-gray-600 text-white',
  };

  const signalLabels = {
    buy: '買進',
    sell: '賣出',
    neutral: '中性',
  };

  return (
    <Card className={cn('w-full', className)}>
      <CardHeader className="pb-3 border-b border-border/50 mb-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-bold">四大買賣點分析</CardTitle>
          <Badge className={signalColors[bestFourPoint.signal]}>
            {signalLabels[bestFourPoint.signal]}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground mt-2">{bestFourPoint.reason}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <h4 className="font-semibold text-sm">買進分析</h4>
            {buyAnalysis.triggered ? (
              <CheckCircle2 className="w-4 h-4 text-red-500" />
            ) : (
              <XCircle className="w-4 h-4 text-muted-foreground" />
            )}
          </div>
          <p className="text-sm text-muted-foreground bg-secondary/50 p-3 rounded-md">
            {buyAnalysis.reason || '無明顯買進訊號'}
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <h4 className="font-semibold text-sm">賣出分析</h4>
            {sellAnalysis.triggered ? (
              <CheckCircle2 className="w-4 h-4 text-green-500" />
            ) : (
              <XCircle className="w-4 h-4 text-muted-foreground" />
            )}
          </div>
          <p className="text-sm text-muted-foreground bg-secondary/50 p-3 rounded-md">
            {sellAnalysis.reason || '無明顯賣出訊號'}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}