'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { languagesData, trafficSourcesData } from '@/lib/mock-data';

interface LanguagesTableProps {
  className?: string;
}

export function LanguagesTable({ className }: LanguagesTableProps) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-sm font-medium">Languages</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[100px]">Language</TableHead>
              <TableHead className="w-[80px]">Users</TableHead>
              <TableHead>% Users</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {languagesData.map((item, index) => (
              <TableRow key={index}>
                <TableCell className="font-medium">{item.language}</TableCell>
                <TableCell>{item.users}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Progress
                      value={item.percentage}
                      className="h-2 w-24 [&>div]:bg-blue-500"
                    />
                    <span className="text-xs text-muted-foreground w-10">
                      {item.percentage.toFixed(1)}%
                    </span>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

interface TrafficSourcesTableProps {
  className?: string;
}

export function TrafficSourcesTable({ className }: TrafficSourcesTableProps) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-sm font-medium">Traffic Sources</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Source</TableHead>
              <TableHead className="text-right">Users</TableHead>
              <TableHead className="text-right">Sessions</TableHead>
              <TableHead className="text-right">Bounce Rate</TableHead>
              <TableHead className="text-right">Avg. Session Duration</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {trafficSourcesData.map((item, index) => (
              <TableRow key={index}>
                <TableCell className="font-medium">{item.source}</TableCell>
                <TableCell className="text-right">{item.users.toLocaleString()}</TableCell>
                <TableCell className="text-right">{item.sessions.toLocaleString()}</TableCell>
                <TableCell className="text-right">
                  <span
                    className={cn(
                      'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                      item.bounceRate < 40
                        ? 'bg-green-500/10 text-green-500'
                        : 'bg-red-500/10 text-red-500'
                    )}
                  >
                    {item.bounceRate}%
                  </span>
                </TableCell>
                <TableCell className="text-right text-muted-foreground">
                  {item.avgDuration}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
