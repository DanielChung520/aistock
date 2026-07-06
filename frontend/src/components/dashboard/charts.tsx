'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { yearlyTrendData, deviceData, sourceMediumData } from '@/lib/mock-data';

interface YearlyTrendChartProps {
  className?: string;
}

export function YearlyTrendChart({ className }: YearlyTrendChartProps) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-sm font-medium">Yearly Trend</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[180px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={yearlyTrendData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis
                dataKey="month"
                tick={{ fontSize: 10, fill: '#9ca3af' }}
              />
              <YAxis
                tick={{ fontSize: 10, fill: '#9ca3af' }}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1e2433',
                  border: '1px solid #374151',
                  borderRadius: '6px',
                  color: '#e5e7eb',
                }}
              />
              <Bar dataKey="value" fill="#3b82f6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

interface DeviceChartProps {
  className?: string;
}

export function DeviceChart({ className }: DeviceChartProps) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-sm font-medium">
          Mobile / Desktop
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[180px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={deviceData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis
                dataKey="month"
                tick={{ fontSize: 10, fill: '#6b7280' }}
              />
              <YAxis
                tick={{ fontSize: 10, fill: '#6b7280' }}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#ffffff',
                  border: '1px solid #e5e7eb',
                  borderRadius: '6px',
                  color: '#1a1d21',
                }}
              />
              <Bar
                dataKey="desktop"
                stackId="a"
                fill="#3b82f6"
                radius={[0, 0, 0, 0]}
              />
              <Bar
                dataKey="mobile"
                stackId="a"
                fill="#93c5fd"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

interface SourceMediumChartProps {
  className?: string;
}

export function SourceMediumChart({ className }: SourceMediumChartProps) {
  const totalRevenue = sourceMediumData.reduce(
    (sum, item) => sum + item.revenue,
    0
  );

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-sm font-medium">Source / Medium</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex gap-4">
          {/* Pie Chart */}
          <div className="relative h-[140px] w-[140px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={sourceMediumData}
                  innerRadius={45}
                  outerRadius={60}
                  paddingAngle={2}
                  dataKey="revenue"
                >
                  {sourceMediumData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-xs text-muted-foreground">+23%</span>
              <span className="text-xs text-muted-foreground">
                new visitors
              </span>
            </div>
          </div>

          {/* Table */}
          <div className="flex-1">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground text-xs">
                  <th className="text-left pb-2">Source</th>
                  <th className="text-right pb-2">Revenue</th>
                  <th className="text-right pb-2">Value</th>
                </tr>
              </thead>
              <tbody>
                {sourceMediumData.map((item, index) => (
                  <tr key={index} className="border-t border-border">
                    <td className="py-2 flex items-center gap-2">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: item.color }}
                      />
                      {item.source}
                    </td>
                    <td className="text-right py-2">${item.revenue}</td>
                    <td
                      className={`text-right py-2 ${
                        item.value.startsWith('+')
                          ? 'text-green-500'
                          : 'text-red-500'
                      }`}
                    >
                      {item.value}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
