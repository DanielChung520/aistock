'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { visitorLocations } from '@/lib/mock-data';

interface WorldMapProps {
  className?: string;
}

export function WorldMap({ className }: WorldMapProps) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-sm font-medium">Real-Time Visitors</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="relative h-[200px] w-full bg-muted/30 rounded-lg overflow-hidden">
          {/* World Map SVG */}
          <svg
            viewBox="0 0 800 400"
            className="w-full h-full opacity-30"
            preserveAspectRatio="xMidYMid slice"
          >
            {/* Simplified continent outlines */}
            <ellipse cx="150" cy="120" rx="80" ry="60" fill="currentColor" className="text-muted-foreground" />
            <ellipse cx="180" cy="250" rx="40" ry="80" fill="currentColor" className="text-muted-foreground" />
            <ellipse cx="400" cy="100" rx="100" ry="50" fill="currentColor" className="text-muted-foreground" />
            <ellipse cx="420" cy="200" rx="60" ry="40" fill="currentColor" className="text-muted-foreground" />
            <ellipse cx="550" cy="150" rx="80" ry="60" fill="currentColor" className="text-muted-foreground" />
            <ellipse cx="650" cy="220" rx="50" ry="40" fill="currentColor" className="text-muted-foreground" />
            <ellipse cx="700" cy="320" rx="60" ry="50" fill="currentColor" className="text-muted-foreground" />
          </svg>

          {/* Visitor dots */}
          {visitorLocations.map((location, index) => {
            // Convert lat/lng to SVG coordinates (simplified)
            const x = ((location.lng + 180) / 360) * 800;
            const y = ((90 - location.lat) / 180) * 400;
            return (
              <div
                key={index}
                className="absolute h-3 w-3 rounded-full bg-blue-500 animate-pulse"
                style={{
                  left: `${(x / 800) * 100}%`,
                  top: `${(y / 400) * 100}%`,
                }}
                title={location.city}
              />
            );
          })}

          {/* Legend */}
          <div className="absolute bottom-2 right-2 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-blue-500" />
              Active visitors
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
