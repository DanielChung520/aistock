'use client'

import Link from 'next/link'
import { Plus, Search, Sparkles, FileText, MoreHorizontal } from 'lucide-react'
import { AppShell } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { getAllOntologies } from './_data/mock-ontology'

const STATUS_LABELS = {
  draft: { label: '草稿', variant: 'secondary' as const },
  active: { label: '活躍', variant: 'default' as const },
  deprecated: { label: '已棄用', variant: 'outline' as const },
}

export default function OntologyListPage() {
  const ontologies = getAllOntologies()

  return (
    <AppShell title="Ontology 管理">
      <div className="flex h-full flex-col gap-3 p-4 md:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="font-mono text-xs">
            v0.1 草稿
          </Badge>
          <span className="text-xs text-muted-foreground">
            管理所有本體：AI 討論、版本發佈、視覺化、NER/RE 抽取設定
          </span>
          <div className="ml-auto">
            <Button variant="outline" size="sm" className="h-9">
              <Sparkles className="h-3.5 w-3.5 mr-1" />
              從模板建立
            </Button>
            <Button size="sm" className="h-9 ml-2">
              <Plus className="h-3.5 w-3.5 mr-1" />
              上傳 JSON
            </Button>
          </div>
        </div>

        <Card className="flex-1 min-h-0 gap-0 overflow-hidden">
          <CardHeader className="border-b border-border pb-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1 rounded-md border border-border bg-background p-0.5">
                <Button size="sm" variant="default" className="h-7">
                  全部
                </Button>
                <Button size="sm" variant="ghost" className="h-7">
                  活躍
                </Button>
                <Button size="sm" variant="ghost" className="h-7">
                  草稿
                </Button>
                <Button size="sm" variant="ghost" className="h-7">
                  已棄用
                </Button>
              </div>

              <div className="relative flex-1 min-w-[200px] max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input placeholder="搜尋 ontology 名稱或標籤..." className="pl-9" />
              </div>

              <div className="ml-auto flex items-center gap-2">
                <Button variant="outline" size="sm">
                  <Sparkles className="h-3.5 w-3.5 mr-1" />
                  從模板建立
                </Button>
                <Button size="sm">
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  上傳 JSON
                </Button>
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-0 flex-1 min-h-0 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[260px]">名稱</TableHead>
                  <TableHead className="w-[100px]">版本</TableHead>
                  <TableHead className="w-[100px]">狀態</TableHead>
                  <TableHead className="w-[80px] text-center">Entity</TableHead>
                  <TableHead className="w-[80px] text-center">Property</TableHead>
                  <TableHead>標籤</TableHead>
                  <TableHead className="w-[140px]">最後修改</TableHead>
                  <TableHead className="w-[60px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ontologies.map((ont) => {
                  const status = STATUS_LABELS[ont.status]
                  return (
                    <TableRow key={ont.name} className="group">
                      <TableCell>
                        <Link
                          href={`/admin/ontology/${ont.name}`}
                          className="flex items-center gap-2 hover:underline"
                        >
                          <FileText className="h-4 w-4 text-muted-foreground" />
                          <div>
                            <div className="font-medium">{ont.display_name}</div>
                            <div className="text-xs text-muted-foreground font-mono">
                              {ont.name}
                            </div>
                          </div>
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="font-mono">
                          v{ont.version}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={status.variant}>{status.label}</Badge>
                      </TableCell>
                      <TableCell className="text-center font-mono">
                        {ont.entity_classes.length}
                      </TableCell>
                      <TableCell className="text-center font-mono">
                        {ont.object_properties.length}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {ont.tags.map((tag) => (
                            <Badge key={tag} variant="secondary" className="text-xs">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(ont.updated_at).toLocaleString('zh-TW', {
                          month: '2-digit',
                          day: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" className="h-7 w-7">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  )
}
