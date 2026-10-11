'use client'

import { useState, useEffect } from 'react'
import { Plus, Pencil, Trash2, ChevronUp, ChevronDown, GripVertical, Loader2, ImageIcon } from 'lucide-react'
import { AppShell } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { IconPicker } from '@/components/ui/icon-picker'
import { iconMap, getIconComponent } from '@/lib/icon-map'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { toast } from 'sonner'
import { MenuItem, MenuGroup, MenuItemWithChildren, MarketIndex, IndexCategory } from '@/types/menu'

const CATEGORY_LABELS: IndexCategory[] = ['台股', '亞股', '美股']

export default function MenuAdminPage() {
  const [loading, setLoading] = useState(true)
  const [menuData, setMenuData] = useState<MenuGroup[]>([])
  const [allGroups, setAllGroups] = useState<{ _key: string; title: string; sortOrder: number; enabled: boolean }[]>([])
  const [indices, setIndices] = useState<MarketIndex[]>([])

  const [isIndexModalOpen, setIsIndexModalOpen] = useState(false)
  const [editingIndex, setEditingIndex] = useState<MarketIndex | null>(null)
  const [indexForm, setIndexForm] = useState({
    symbol: '',
    yfSymbol: '',
    name: '',
    category: '美股' as IndexCategory,
    enabled: true,
    sortOrder: 0,
  })

  const [isGroupModalOpen, setIsGroupModalOpen] = useState(false)
  const [editingGroup, setEditingGroup] = useState<{ _key: string; title: string; sortOrder: number; enabled: boolean } | null>(null)
  const [groupForm, setGroupForm] = useState({ title: '', sortOrder: 0, enabled: true })

  const [isItemModalOpen, setIsItemModalOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<MenuItemWithChildren | null>(null)
  const [itemForm, setItemForm] = useState({
    title: '',
    href: '',
    groupKey: '',
    parentKey: '',
    badge: '',
    icon: '',
    sortOrder: 0,
    isGroup: false,
    enabled: true,
  })
  const [iconPickerOpen, setIconPickerOpen] = useState(false)

  const fetchData = async () => {
    setLoading(true)
    try {
      const [menuRes, groupsRes, indicesRes] = await Promise.all([
        fetch('/api/menu'),
        fetch('/api/menu/groups'),
        fetch('/api/market-indices')
      ])
      
      if (!menuRes.ok) throw new Error('Failed to fetch menu data')
      if (!groupsRes.ok) throw new Error('Failed to fetch groups data')
      if (!indicesRes.ok) throw new Error('Failed to fetch market indices')

      const menuData = await menuRes.json()
      const groupsData = await groupsRes.json()
      const indicesData = await indicesRes.json()

      setMenuData(menuData.menu || [])
      setAllGroups(groupsData || [])
      setIndices(indicesData.indices || [])
    } catch (error) {
      toast.error('Error fetching data')
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  const handleSaveGroup = async () => {
    try {
      const method = editingGroup ? 'PUT' : 'POST'
      const body = editingGroup ? { _key: editingGroup._key, ...groupForm } : groupForm

      const res = await fetch('/api/menu/groups', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) throw new Error('Failed to save group')

      toast.success(editingGroup ? 'Group updated' : 'Group created')
      setIsGroupModalOpen(false)
      fetchData()
    } catch (error) {
      toast.error('Error saving group')
    }
  }

  const handleDeleteGroup = async (key: string) => {
    if (!window.confirm('Are you sure you want to delete this group?')) return

    try {
      const res = await fetch(`/api/menu/groups?key=${key}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete group')

      toast.success('Group deleted')
      fetchData()
    } catch (error) {
      toast.error('Error deleting group')
    }
  }

  const handleSaveItem = async () => {
    try {
      const method = editingItem ? 'PUT' : 'POST'
      const payload: Record<string, unknown> = {
        title: itemForm.title,
        href: itemForm.href,
        groupKey: itemForm.groupKey,
        sortOrder: itemForm.sortOrder,
        isGroup: itemForm.isGroup,
        enabled: itemForm.enabled,
      }
      
      if (itemForm.parentKey && itemForm.parentKey !== 'none') {
        payload.parentKey = itemForm.parentKey
      } else {
        payload.parentKey = null
      }
      
      if (itemForm.badge) {
        payload.badge = itemForm.badge
      }

      if (itemForm.icon) {
        payload.icon = itemForm.icon
      }

      const body = editingItem ? { _key: editingItem._key, ...payload } : payload

      const res = await fetch('/api/menu', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) throw new Error('Failed to save item')

      toast.success(editingItem ? 'Item updated' : 'Item created')
      setIsItemModalOpen(false)
      fetchData()
    } catch (error) {
      toast.error('Error saving item')
    }
  }

  const handleDeleteItem = async (key: string) => {
    if (!window.confirm('Are you sure you want to delete this item?')) return

    try {
      const res = await fetch(`/api/menu?key=${key}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete item')

      toast.success('Item deleted')
      fetchData()
    } catch (error) {
      toast.error('Error deleting item')
    }
  }

  const handleSaveIndex = async () => {
    if (!indexForm.symbol.trim()) {
      toast.error('請輸入指數代號')
      return
    }

    try {
      const method = editingIndex ? 'PUT' : 'POST'
      const body = editingIndex
        ? { _key: editingIndex._key, ...indexForm }
        : { ...indexForm, symbol: indexForm.symbol.trim().toUpperCase() }

      const res = await fetch('/api/market-indices', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) throw new Error('Failed to save index')

      toast.success(editingIndex ? '指數已更新' : '指數已新增')
      setIsIndexModalOpen(false)
      fetchData()
    } catch (error) {
      toast.error('儲存指數失敗')
    }
  }

  const handleDeleteIndex = async (key: string) => {
    if (!window.confirm('確定要刪除此指數？')) return

    try {
      const res = await fetch(`/api/market-indices?key=${key}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete index')

      toast.success('指數已刪除')
      fetchData()
    } catch (error) {
      toast.error('刪除指數失敗')
    }
  }

  const updateIndexSort = async (key: string, newOrder: number) => {
    try {
      await fetch('/api/market-indices', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ _key: key, sortOrder: newOrder }),
      })
      fetchData()
    } catch (error) {
      toast.error('排序更新失敗')
    }
  }

  const openIndexModal = (index: MarketIndex | null = null) => {
    setEditingIndex(index)
    if (index) {
      setIndexForm({
        symbol: index.symbol,
        yfSymbol: index.yfSymbol,
        name: index.name,
        category: index.category,
        enabled: index.enabled,
        sortOrder: index.sortOrder,
      })
    } else {
      setIndexForm({
        symbol: '',
        yfSymbol: '',
        name: '',
        category: '美股',
        enabled: true,
        sortOrder: indices.length,
      })
    }
    setIsIndexModalOpen(true)
  }

  const updateGroupSort = async (key: string, newOrder: number) => {
    try {
      await fetch('/api/menu/groups', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ _key: key, sortOrder: newOrder }),
      })
      fetchData()
    } catch (error) {
      toast.error('Failed to reorder group')
    }
  }

  const updateItemSort = async (key: string, newOrder: number) => {
    try {
      await fetch('/api/menu', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ _key: key, sortOrder: newOrder }),
      })
      fetchData()
    } catch (error) {
      toast.error('Failed to reorder item')
    }
  }

  const openGroupModal = (group: { _key: string; title: string; sortOrder: number; enabled: boolean } | null = null) => {
    setEditingGroup(group)
    if (group) {
      setGroupForm({ 
        title: group.title, 
        sortOrder: group.sortOrder, 
        enabled: group.enabled 
      })
    } else {
      setGroupForm({ title: '', sortOrder: allGroups.length, enabled: true })
    }
    setIsGroupModalOpen(true)
  }

  const openItemModal = (groupKey: string, item: MenuItemWithChildren | null = null) => {
    setEditingItem(item)
    if (item) {
      setItemForm({
        title: item.title,
        href: item.href,
        groupKey: item.groupKey || groupKey,
        parentKey: item.parentKey || 'none',
        badge: (item.badge as string) || '',
        icon: (item.icon as string) || '',
        sortOrder: item.sortOrder,
        isGroup: item.isGroup,
        enabled: item.enabled,
      })
    } else {
      setItemForm({
        title: '',
        href: '',
        groupKey,
        parentKey: 'none',
        badge: '',
        icon: '',
        sortOrder: 0,
        isGroup: false,
        enabled: true,
      })
    }
    setIsItemModalOpen(true)
  }

  const getParentOptions = (groupKey: string) => {
    const group = menuData.find(g => g.key === groupKey)
    if (!group) return []
    return group.items.filter(i => !i.parentKey)
  }

  if (loading && !menuData.length) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <AppShell title="選單管理">
      <div className="h-full overflow-auto">
        <div className="p-4 md:p-6 space-y-6">
          <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Menu Groups</CardTitle>
          <Button onClick={() => openGroupModal()}>
            <Plus className="mr-2 h-4 w-4" /> Add Group
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">Order</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {allGroups.map((group, index) => (
                <TableRow key={group._key}>
                  <TableCell>
                    <div className="flex flex-col items-center">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => updateGroupSort(group._key, group.sortOrder - 1)}
                        disabled={index === 0}
                      >
                        <ChevronUp className="h-4 w-4" />
                      </Button>
                      <Badge variant="outline">{group.sortOrder}</Badge>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => updateGroupSort(group._key, group.sortOrder + 1)}
                        disabled={index === allGroups.length - 1}
                      >
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                  <TableCell className="font-medium">{group.title}</TableCell>
                  <TableCell>
                    <Switch
                      checked={group.enabled}
                      onCheckedChange={(checked) => {
                        fetch('/api/menu/groups', {
                          method: 'PUT',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ _key: group._key, enabled: checked }),
                        }).then(() => fetchData()).catch(() => toast.error('Failed to update group status'))
                      }}
                    />
                  </TableCell>
                  <TableCell className="text-right space-x-2">
                    <Button variant="outline" size="icon" onClick={() => openGroupModal(group)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="destructive" size="icon" onClick={() => handleDeleteGroup(group._key)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {allGroups.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    No menu groups found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {menuData.map((group) => (
        <Card key={group.key}>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>{group.title} Items</CardTitle>
            <Button onClick={() => openItemModal(group.key)} variant="secondary">
              <Plus className="mr-2 h-4 w-4" /> Add Item
            </Button>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">Order</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Href</TableHead>
                  <TableHead>Icon</TableHead>
                  <TableHead>Badge</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {group.items.map((item, index) => (
                  <TableRow key={item._key}>
                    <TableCell>
                      <div className="flex flex-col items-center">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => updateItemSort(item._key, item.sortOrder - 1)}
                          disabled={index === 0}
                        >
                          <ChevronUp className="h-4 w-4" />
                        </Button>
                        <Badge variant="outline">{item.sortOrder}</Badge>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => updateItemSort(item._key, item.sortOrder + 1)}
                          disabled={index === group.items.length - 1}
                        >
                          <ChevronDown className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell className="font-medium">
                      {item.title}
                      {item.children && item.children.length > 0 && (
                        <div className="text-sm text-muted-foreground mt-1 ml-4 pl-2 border-l border-border space-y-1">
                          {item.children.map(child => (
                            <div key={child._key} className="flex items-center justify-between">
                              <span className="flex items-center">
                                <GripVertical className="h-3 w-3 mr-1 opacity-50" />
                                {child.title}
                              </span>
                              <div className="space-x-1">
                                <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => openItemModal(group.key, child)}>
                                  <Pencil className="h-3 w-3" />
                                </Button>
                                <Button variant="ghost" size="icon" className="h-5 w-5 text-destructive" onClick={() => handleDeleteItem(child._key)}>
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground font-mono text-sm">{item.href}</TableCell>
                    <TableCell>
                      {(() => {
                        const IconComp = getIconComponent(item.icon)
                        return IconComp ? <IconComp className="h-4 w-4 text-muted-foreground" /> : <span className="text-muted-foreground text-xs">—</span>
                      })()}
                    </TableCell>
                    <TableCell>
                      {item.badge && <Badge variant="secondary">{item.badge}</Badge>}
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={item.enabled}
                        onCheckedChange={(checked) => {
                          fetch('/api/menu', {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ _key: item._key, enabled: checked }),
                          }).then(() => fetchData()).catch(() => toast.error('Failed to update item status'))
                        }}
                      />
                    </TableCell>
                    <TableCell className="text-right space-x-2">
                      <Button variant="outline" size="icon" onClick={() => openItemModal(group.key, item)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="destructive" size="icon" onClick={() => handleDeleteItem(item._key)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {group.items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">
                      No items in this group.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>指數清單（市場環境）</CardTitle>
          <Button onClick={() => openIndexModal()}>
            <Plus className="mr-2 h-4 w-4" /> 新增指數
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">順序</TableHead>
                <TableHead>代號</TableHead>
                <TableHead>yfinance</TableHead>
                <TableHead>名稱</TableHead>
                <TableHead>類別</TableHead>
                <TableHead>啟用</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {indices.map((index, i) => (
                <TableRow key={index._key}>
                  <TableCell>
                    <div className="flex flex-col items-center">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => updateIndexSort(index._key!, index.sortOrder - 1)}
                        disabled={i === 0}
                      >
                        <ChevronUp className="h-4 w-4" />
                      </Button>
                      <Badge variant="outline">{index.sortOrder}</Badge>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => updateIndexSort(index._key!, index.sortOrder + 1)}
                        disabled={i === indices.length - 1}
                      >
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                  <TableCell className="font-mono font-medium">{index.symbol}</TableCell>
                  <TableCell className="font-mono text-muted-foreground text-sm">{index.yfSymbol}</TableCell>
                  <TableCell className="font-medium">{index.name}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{index.category}</Badge>
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={index.enabled}
                      onCheckedChange={(checked) => {
                        fetch('/api/market-indices', {
                          method: 'PUT',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ _key: index._key, enabled: checked }),
                        }).then(() => fetchData()).catch(() => toast.error('更新指數狀態失敗'))
                      }}
                    />
                  </TableCell>
                  <TableCell className="text-right space-x-2">
                    <Button variant="outline" size="icon" onClick={() => openIndexModal(index)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="destructive" size="icon" onClick={() => handleDeleteIndex(index._key!)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {indices.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    尚無指數，請點擊「新增指數」。
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <p className="mt-3 text-xs text-muted-foreground">
            此清單供市場指數下載使用（回補 2 年 + 每日增量）。yfinance 代號範例：^TWII、^TWO、^N225、^HSI、000001.SS、^KS11、^SOX、^IXIC、^GSPC、^DJI。
          </p>
        </CardContent>
      </Card>

      <Dialog open={isGroupModalOpen} onOpenChange={setIsGroupModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingGroup ? 'Edit Group' : 'Create Group'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="group-title">Title</Label>
              <Input
                id="group-title"
                value={groupForm.title}
                onChange={(e) => setGroupForm({ ...groupForm, title: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="group-sort">Sort Order</Label>
              <Input
                id="group-sort"
                type="number"
                value={groupForm.sortOrder}
                onChange={(e) => setGroupForm({ ...groupForm, sortOrder: parseInt(e.target.value) || 0 })}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="group-enabled">Enabled</Label>
              <Switch
                id="group-enabled"
                checked={groupForm.enabled}
                onCheckedChange={(c) => setGroupForm({ ...groupForm, enabled: c })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsGroupModalOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveGroup}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isItemModalOpen} onOpenChange={setIsItemModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingItem ? 'Edit Item' : 'Create Item'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="item-title">Title</Label>
              <Input
                id="item-title"
                value={itemForm.title}
                onChange={(e) => setItemForm({ ...itemForm, title: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="item-href">Href</Label>
              <Input
                id="item-href"
                value={itemForm.href}
                onChange={(e) => setItemForm({ ...itemForm, href: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="item-parent">Parent Item (Optional)</Label>
              <Select
                value={itemForm.parentKey || 'none'}
                onValueChange={(val) => setItemForm({ ...itemForm, parentKey: val })}
              >
                <SelectTrigger id="item-parent">
                  <SelectValue placeholder="Select parent item" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None (Top Level)</SelectItem>
                  {getParentOptions(itemForm.groupKey).map((parent) => (
                    <SelectItem key={parent._key} value={parent._key}>
                      {parent.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="item-badge">Badge (Optional)</Label>
              <Input
                id="item-badge"
                value={itemForm.badge}
                onChange={(e) => setItemForm({ ...itemForm, badge: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>圖標</Label>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => setIconPickerOpen(true)}
                >
                  {itemForm.icon ? (
                    <>
                      {(() => {
                        const IconComp = iconMap[itemForm.icon]
                        return IconComp ? <IconComp className="h-4 w-4" /> : null
                      })()}
                      {itemForm.icon}
                    </>
                  ) : (
                    <>
                      <ImageIcon className="h-4 w-4" />
                      選擇圖標
                    </>
                  )}
                </Button>
                {itemForm.icon && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground h-7 px-2"
                    onClick={() => setItemForm({ ...itemForm, icon: '' })}
                  >
                    清除
                  </Button>
                )}
              </div>
            </div>
            <IconPicker
              open={iconPickerOpen}
              onOpenChange={setIconPickerOpen}
              onSelect={(icon) => setItemForm({ ...itemForm, icon })}
              currentIcon={itemForm.icon}
            />
            <div className="space-y-2">
              <Label htmlFor="item-sort">Sort Order</Label>
              <Input
                id="item-sort"
                type="number"
                value={itemForm.sortOrder}
                onChange={(e) => setItemForm({ ...itemForm, sortOrder: parseInt(e.target.value) || 0 })}
              />
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <Label htmlFor="item-enabled">Enabled</Label>
              <Switch
                id="item-enabled"
                checked={itemForm.enabled}
                onCheckedChange={(c) => setItemForm({ ...itemForm, enabled: c })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsItemModalOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveItem}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isIndexModalOpen} onOpenChange={setIsIndexModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingIndex ? '編輯指數' : '新增指數'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="index-symbol">指數代號（唯一）</Label>
              <Input
                id="index-symbol"
                placeholder="TWII"
                value={indexForm.symbol}
                disabled={!!editingIndex}
                onChange={(e) => setIndexForm({ ...indexForm, symbol: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="index-yf-symbol">yfinance 代號</Label>
              <Input
                id="index-yf-symbol"
                placeholder="^TWII"
                value={indexForm.yfSymbol}
                onChange={(e) => setIndexForm({ ...indexForm, yfSymbol: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="index-name">名稱</Label>
              <Input
                id="index-name"
                placeholder="加權指數"
                value={indexForm.name}
                onChange={(e) => setIndexForm({ ...indexForm, name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="index-category">類別</Label>
              <Select
                value={indexForm.category}
                onValueChange={(val) => setIndexForm({ ...indexForm, category: val as IndexCategory })}
              >
                <SelectTrigger id="index-category">
                  <SelectValue placeholder="選擇類別" />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORY_LABELS.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="index-sort">排序</Label>
              <Input
                id="index-sort"
                type="number"
                value={indexForm.sortOrder}
                onChange={(e) => setIndexForm({ ...indexForm, sortOrder: parseInt(e.target.value) || 0 })}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="index-enabled">啟用</Label>
              <Switch
                id="index-enabled"
                checked={indexForm.enabled}
                onCheckedChange={(c) => setIndexForm({ ...indexForm, enabled: c })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsIndexModalOpen(false)}>取消</Button>
            <Button onClick={handleSaveIndex}>儲存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
        </div>
      </div>
    </AppShell>
  )
}
