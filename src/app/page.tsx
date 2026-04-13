"use client";

import { useState, useCallback, useMemo, memo } from "react";
import useSWR, { useSWRConfig } from "swr";
import { 
  getAppData, 
  addItemAction, 
  toggleItemAction, 
  clearCheckedAction, 
  deleteItemAction,
  moveItemAction,
  renameItemAction,
  moveTaskToShoppingAction
} from "./actions";
import { Item, Category, ItemType } from "@prisma/client";
import { useSSE } from "@/hooks/useSSE";

const fetcher = () => getAppData();

export default function Home() {
  const { mutate } = useSWRConfig();
  const { data, isLoading } = useSWR("app-data", fetcher, {
    revalidateOnFocus: true,
    refreshInterval: 60000, 
  });

  const [tab, setTab] = useState<ItemType>("TASK");
  const [inputValue, setInputValue] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  const refresh = useCallback(() => {
    mutate("app-data");
  }, [mutate]);

  useSSE(refresh);

  const { processingItems, tasks, shoppingItems } = useMemo(() => {
    const items = data?.items || [];
    return {
      processingItems: items.filter(i => i.name.startsWith("🔄")),
      tasks: items.filter(i => !i.name.startsWith("🔄") && i.type === "TASK"),
      shoppingItems: items.filter(i => !i.name.startsWith("🔄") && i.type === "SHOPPING")
    };
  }, [data?.items]);

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = inputValue.trim();
    if (!text || isAdding) return;

    setIsAdding(true);
    setInputValue("");
    
    // Optimistic Update
    const tempId = Math.random().toString();
    mutate("app-data", {
      ...data,
      items: [{ id: tempId, name: `🔄 מעבד: ${text}`, type: "TASK", isChecked: false, categoryId: null, createdAt: new Date(), updatedAt: new Date(), order: 0 }, ...(data?.items || [])]
    }, false);

    try {
      await addItemAction(text);
      refresh();
    } catch (err) {
      refresh();
    } finally {
      setIsAdding(false);
    }
  };

  const handleToggle = useCallback(async (id: string, checked: boolean) => {
    mutate("app-data", {
      ...data,
      items: data?.items.map((i: Item) => i.id === id ? { ...i, isChecked: checked } : i)
    }, false);
    await toggleItemAction(id, checked);
    refresh();
  }, [data, mutate, refresh]);

  const handleDelete = useCallback(async (id: string) => {
    if (!confirm("למחוק את הפריט?")) return;
    mutate("app-data", {
      ...data,
      items: data?.items.filter((i: Item) => i.id !== id)
    }, false);
    await deleteItemAction(id);
    refresh();
  }, [data, mutate, refresh]);

  const handleRename = useCallback(async (id: string, currentName: string) => {
    const newName = prompt("שם חדש:", currentName);
    if (newName && newName !== currentName) {
      await renameItemAction(id, newName);
      refresh();
    }
  }, [refresh]);

  const handleMoveItem = useCallback(async (id: string, type: ItemType, categoryId: string | null = null) => {
    await moveItemAction(id, type, categoryId);
    refresh();
  }, [refresh]);

  const handleMoveToShopping = useCallback(async (id: string) => {
    await moveTaskToShoppingAction(id);
    refresh();
  }, [refresh]);

  return (
    <main className="min-h-screen bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 transition-colors duration-200 pb-20">
      <div className="max-w-md mx-auto px-4 py-8">
        <h1 className="text-3xl font-black text-center mb-8 tracking-tighter text-blue-600 dark:text-blue-500 italic">
          Home Lists
        </h1>
        
        {/* Input Bar */}
        <form onSubmit={handleAddItem} className="mb-4 flex gap-2">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="מה להוסיף?"
            className="flex-1 p-4 bg-zinc-100 dark:bg-zinc-900 border-none rounded-2xl shadow-inner focus:ring-2 focus:ring-blue-500/20 transition-all text-base font-medium"
            disabled={isAdding}
          />
          <button
            type="submit"
            className="bg-blue-600 text-white px-6 py-4 rounded-2xl font-black shadow-lg shadow-blue-500/30 hover:bg-blue-700 active:scale-95 disabled:bg-zinc-400 transition-all"
            disabled={isAdding}
          >
            {isAdding ? "..." : "הוסף"}
          </button>
        </form>

        {/* Processing State Section */}
        <div className="flex flex-col gap-2 px-1 mb-6">
          {processingItems.map(item => (
            <div key={item.id} className="flex items-center gap-2 text-xs font-bold text-blue-500 animate-pulse">
              <div className="w-2 h-2 bg-blue-500 rounded-full shadow-[0_0_8px_rgba(59,130,246,0.5)]"></div>
              <span>{item.name}</span>
            </div>
          ))}
        </div>

        {/* Tab Switcher */}
        <div className="flex bg-zinc-100 dark:bg-zinc-900 p-1 rounded-2xl mb-8 shadow-inner">
          <button
            onClick={() => setTab("TASK")}
            className={`flex-1 py-3 text-base font-black rounded-xl transition-all ${
              tab === "TASK" 
                ? "bg-white dark:bg-zinc-800 shadow-md text-blue-600 dark:text-blue-400" 
                : "text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
            }`}
          >
            משימות
          </button>
          <button
            onClick={() => setTab("SHOPPING")}
            className={`flex-1 py-3 text-base font-black rounded-xl transition-all ${
              tab === "SHOPPING" 
                ? "bg-white dark:bg-zinc-800 shadow-md text-blue-600 dark:text-blue-400" 
                : "text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
            }`}
          >
            קניות
          </button>
        </div>

        {/* Content Area */}
        {isLoading && !data ? (
          <div className="text-center py-20 opacity-20 font-black text-xs tracking-widest uppercase">Loading</div>
        ) : (
          <div className="space-y-4">
            {tab === "TASK" ? (
              <TaskList 
                items={tasks} 
                categories={data?.categories || []}
                onToggle={handleToggle} 
                onClear={async () => {
                  if (confirm("לנקות משימות שהושלמו?")) {
                    await clearCheckedAction("TASK");
                    refresh();
                  }
                }}
                onDelete={handleDelete}
                onRename={handleRename}
                onMoveToShopping={handleMoveToShopping}
              />
            ) : (
              <ShoppingList 
                items={shoppingItems} 
                categories={data?.categories || []}
                onToggle={handleToggle}
                onClear={async () => {
                  if (confirm("לנקות פריטים שנקנו?")) {
                    await clearCheckedAction("SHOPPING");
                    refresh();
                  }
                }}
                onDelete={handleDelete}
                onRename={handleRename}
                onMove={handleMoveItem}
              />
            )}
          </div>
        )}
      </div>
    </main>
  );
}

const TaskList = memo(({ items, categories, onToggle, onClear, onDelete, onRename, onMoveToShopping }: { 
  items: Item[], 
  categories: Category[],
  onToggle: (id: string, checked: boolean) => void,
  onClear: () => void,
  onDelete: (id: string) => void,
  onRename: (id: string, name: string) => void,
  onMoveToShopping: (id: string) => void
}) => {
  const activeItems = useMemo(() => items.filter(i => !i.isChecked), [items]);
  const checkedItems = useMemo(() => items.filter(i => i.isChecked), [items]);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        {activeItems.map(item => (
          <ItemRow 
            key={item.id} 
            item={item} 
            categories={categories} 
            onToggle={onToggle} 
            onDelete={onDelete} 
            onRename={onRename}
            onMove={() => onMoveToShopping(item.id)}
            isTask
          />
        ))}
        {activeItems.length === 0 && (
          <div className="text-center py-12 text-zinc-300 dark:text-zinc-700 bg-zinc-50/50 dark:bg-zinc-900/30 rounded-3xl border-2 border-dashed border-zinc-100 dark:border-zinc-900 font-bold text-xs">
            אין משימות
          </div>
        )}
      </div>
      
      {checkedItems.length > 0 && (
        <div className="mt-8 border-t-2 border-zinc-50 dark:border-zinc-900 pt-6">
          <button 
            onClick={onClear}
            className="w-full py-3 text-xs font-black text-red-500 bg-red-50/50 dark:bg-red-950/10 border-2 border-red-100/50 dark:border-red-900/20 rounded-xl hover:bg-red-50 transition-all mb-6"
          >
            נקה משימות שהושלמו
          </button>
          <div className="space-y-2 opacity-40 grayscale">
            {checkedItems.map(item => (
              <ItemRow key={item.id} item={item} categories={categories} onToggle={onToggle} onDelete={onDelete} onRename={onRename} onMove={() => onMoveToShopping(item.id)} isTask />
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

const ItemRow = memo(({ item, categories, onToggle, onDelete, onRename, onMove, isTask }: { 
  item: Item, 
  categories: Category[],
  onToggle: (id: string, checked: boolean) => void,
  onDelete: (id: string) => void,
  onRename: (id: string, name: string) => void,
  onMove: (id: string, type: ItemType, categoryId: string | null) => void,
  isTask?: boolean
}) => {
  const [showMoveMenu, setShowMoveMenu] = useState(false);
  const stores = useMemo(() => categories.filter(c => !c.parentId), [categories]);

  return (
    <div className="flex flex-col bg-white dark:bg-zinc-900 rounded-2xl shadow-sm border border-zinc-100 dark:border-zinc-800/50 overflow-hidden transition-all hover:shadow-md">
      <div className="flex items-center gap-3 p-4">
        <input 
          type="checkbox" 
          checked={item.isChecked}
          onChange={(e) => onToggle(item.id, e.target.checked)}
          className="w-6 h-6 rounded-lg border-2 border-zinc-200 dark:border-zinc-700 text-blue-600 focus:ring-0 appearance-none checked:bg-blue-600 checked:border-blue-600"
        />
        
        <span className={`flex-1 text-base ${item.isChecked ? "line-through text-zinc-300 dark:text-zinc-700" : "font-bold text-zinc-800 dark:text-zinc-200"}`}>
          {item.name}
        </span>
        
        <div className="flex gap-0.5">
          <button onClick={() => onRename(item.id, item.name)} className="p-2 text-zinc-300 dark:text-zinc-600 active:text-blue-500 transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
          </button>
          <button onClick={() => setShowMoveMenu(!showMoveMenu)} className="p-2 text-zinc-300 dark:text-zinc-600 active:text-blue-500 transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M16 3h5v5"/><path d="M8 3H3v5"/><path d="M16 21h5v-5"/><path d="M8 21H3v-5"/><path d="m15 15 6 6"/><path d="m9 9-6-6"/><path d="m21 3-6 6"/><path d="m3 21 6-6"/></svg>
          </button>
          <button onClick={() => onDelete(item.id)} className="p-2 text-zinc-300 dark:text-zinc-600 active:text-red-500 transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>
          </button>
        </div>
      </div>

      {showMoveMenu && (
        <div className="p-3 bg-zinc-50 dark:bg-zinc-800/50 border-t border-zinc-100 dark:border-zinc-800">
          {isTask ? (
            <button 
              onClick={() => { onMove(item.id, "SHOPPING", null); setShowMoveMenu(false); }}
              className="w-full p-3 bg-blue-600 text-white rounded-xl font-black text-sm shadow-sm active:scale-[0.98] transition-all flex items-center justify-center gap-2"
            >
              <span>העבר לקניות (סיווג AI)</span>
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 7-7 7 7"/><path d="M12 19V5"/></svg>
            </button>
          ) : (
            <div className="flex flex-col gap-3">
              <button 
                onClick={() => { onMove(item.id, "TASK", null); setShowMoveMenu(false); }}
                className="w-full p-3 bg-white dark:bg-zinc-900 rounded-xl border-2 border-zinc-200 dark:border-zinc-700 font-black text-sm active:bg-zinc-100 transition-all"
              >
                העבר למשימות
              </button>
              <div className="space-y-2">
                <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest px-1">בחר מיקום חדש:</p>
                <div className="grid grid-cols-1 gap-2">
                  {stores.map(store => (
                    <div key={store.id} className="space-y-1">
                      <p className="text-[9px] font-bold text-blue-500/60 px-1">{store.name}</p>
                      <div className="flex flex-wrap gap-1">
                        <button 
                          onClick={() => { onMove(item.id, "SHOPPING", store.id); setShowMoveMenu(false); }}
                          className="px-3 py-2 bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-700 font-bold text-[10px] active:border-blue-500"
                        >
                          כללי
                        </button>
                        {categories.filter(c => c.parentId === store.id).map(div => (
                          <button 
                            key={div.id}
                            onClick={() => { onMove(item.id, "SHOPPING", div.id); setShowMoveMenu(false); }}
                            className="px-3 py-2 bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-700 font-bold text-[10px] active:border-blue-500"
                          >
                            {div.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

const ShoppingList = memo(({ items, categories, onToggle, onClear, onDelete, onRename, onMove }: { 
  items: Item[], 
  categories: Category[],
  onToggle: (id: string, checked: boolean) => void,
  onClear: () => void,
  onDelete: (id: string) => void,
  onRename: (id: string, name: string) => void,
  onMove: (id: string, type: ItemType, categoryId: string | null) => void
}) => {
  const topLevelCategories = useMemo(() => categories.filter(c => !c.parentId), [categories]);
  
  const categoriesWithItems = useMemo(() => {
    return topLevelCategories.filter(cat => {
      const hasDirectItems = items.some(i => i.categoryId === cat.id && !i.isChecked);
      const subCats = categories.filter(sub => sub.parentId === cat.id);
      const hasSubItems = subCats.some(sub => items.some(i => i.categoryId === sub.id && !i.isChecked));
      return hasDirectItems || hasSubItems;
    });
  }, [topLevelCategories, items, categories]);

  const uncategorizedItems = useMemo(() => items.filter(i => !i.categoryId), [items]);

  return (
    <div className="space-y-8">
      <div className="space-y-8">
        {categoriesWithItems.map(cat => (
          <CategoryView 
            key={cat.id} 
            category={cat} 
            allCategories={categories} 
            allItems={items} 
            onToggle={onToggle}
            onDelete={onDelete}
            onRename={onRename}
            onMove={onMove}
          />
        ))}
        
        {uncategorizedItems.some(i => !i.isChecked) && (activeItems => (
          <div className="space-y-3">
            <h3 className="text-[10px] font-black text-zinc-400 uppercase tracking-widest px-2">כללי</h3>
            <div className="space-y-2">
              {uncategorizedItems.filter(i => !i.isChecked).map(item => (
                <ItemRow key={item.id} item={item} categories={categories} onToggle={onToggle} onDelete={onDelete} onRename={onRename} onMove={onMove} />
              ))}
            </div>
          </div>
        ))(uncategorizedItems)}

        {categoriesWithItems.length === 0 && uncategorizedItems.filter(i => !i.isChecked).length === 0 && (
          <div className="text-center py-16 text-zinc-300 dark:text-zinc-700 bg-zinc-50/50 dark:bg-zinc-900/30 rounded-3xl border-2 border-dashed border-zinc-100 dark:border-zinc-900 font-bold text-xs">
            אין פריטים לקנייה
          </div>
        )}
      </div>

      {items.some(i => i.isChecked) && (
        <div className="mt-12 border-t-2 border-zinc-50 dark:border-zinc-900 pt-8">
          <button 
            onClick={onClear}
            className="w-full py-3 text-xs font-black text-red-500 bg-red-50/50 dark:bg-red-950/10 border-2 border-red-100/50 dark:border-red-900/20 rounded-xl hover:bg-red-50 transition-all mb-8"
          >
            נקה פריטים שנקנו
          </button>
          <div className="space-y-2 opacity-40 grayscale">
            {items.filter(i => i.isChecked).map(item => (
              <ItemRow key={item.id} item={item} categories={categories} onToggle={onToggle} onDelete={onDelete} onRename={onRename} onMove={onMove} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

const CategoryView = memo(({ category, allCategories, allItems, onToggle, onDelete, onRename, onMove }: { 
  category: Category, 
  allCategories: Category[], 
  allItems: Item[],
  onToggle: (id: string, checked: boolean) => void,
  onDelete: (id: string) => void,
  onRename: (id: string, name: string) => void,
  onMove: (id: string, type: ItemType, categoryId: string | null) => void
}) => {
  const subCategories = useMemo(() => allCategories.filter(c => c.parentId === category.id), [allCategories, category.id]);
  const items = useMemo(() => allItems.filter(i => i.categoryId === category.id && !i.isChecked), [allItems, category.id]);

  const visibleSubCategories = useMemo(() => {
    return subCategories.filter(sub => {
      const hasDirectItems = allItems.some(i => i.categoryId === sub.id && !i.isChecked);
      return hasDirectItems;
    });
  }, [subCategories, allItems]);

  if (items.length === 0 && visibleSubCategories.length === 0) return null;

  return (
    <div className="space-y-4 border-r-4 border-blue-500/10 pr-4">
      <h3 className="text-lg font-black text-zinc-800 dark:text-zinc-100 tracking-tight">{category.name}</h3>
      <div className="space-y-2">
        {items.map(item => (
          <ItemRow key={item.id} item={item} categories={allCategories} onToggle={onToggle} onDelete={onDelete} onRename={onRename} onMove={onMove} />
        ))}
        {visibleSubCategories.map(sub => (
          <div key={sub.id} className="space-y-2 pt-2">
            <h4 className="text-[10px] font-black text-blue-500/60 uppercase tracking-widest px-1">{sub.name}</h4>
            {allItems.filter(i => i.categoryId === sub.id && !i.isChecked).map(item => (
              <ItemRow key={item.id} item={item} categories={allCategories} onToggle={onToggle} onDelete={onDelete} onRename={onRename} onMove={onMove} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
});
