'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { Search } from 'lucide-react';

export interface TickerSearchProps {
  onSelect: (stock: { stock_id: string; name: string }) => void;
  placeholder?: string;
  className?: string;
}

export function TickerSearch({ onSelect, placeholder = '搜尋股票代碼或名稱...', className }: TickerSearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Array<{ stock_id: string; name: string }>>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (query.trim().length === 0) {
        setResults([]);
        setIsOpen(false);
        return;
      }

      const fetchResults = async () => {
        setIsLoading(true);
        try {
          const res = await fetch(`/api/stocks/search?q=${encodeURIComponent(query)}`);
          if (res.ok) {
            const data = await res.json();
            setResults(Array.isArray(data) ? data : []);
            setIsOpen(true);
          }
        } catch (error) {
          console.error('Failed to search stocks:', error);
          setResults([]);
        } finally {
          setIsLoading(false);
        }
      };

      fetchResults();
    }, 300);

    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (stock: { stock_id: string; name: string }) => {
    setQuery('');
    setIsOpen(false);
    onSelect(stock);
  };

  return (
    <div ref={containerRef} className={cn('relative w-full', className)}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => {
            if (results.length > 0) setIsOpen(true);
          }}
          placeholder={placeholder}
          className="pl-9"
        />
      </div>

      {isOpen && (
        <div className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-md shadow-md max-h-60 overflow-y-auto">
          {isLoading ? (
            <div className="p-4 text-sm text-center text-muted-foreground">搜尋中...</div>
          ) : results.length > 0 ? (
            <ul className="py-1">
              {results.map((stock) => (
                <li
                  key={stock.stock_id}
                  className="px-4 py-2 text-sm cursor-pointer hover:bg-accent hover:text-accent-foreground"
                  onClick={() => handleSelect(stock)}
                >
                  <span className="font-semibold mr-2">{stock.stock_id}</span>
                  <span>{stock.name}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="p-4 text-sm text-center text-muted-foreground">找不到結果</div>
          )}
        </div>
      )}
    </div>
  );
}