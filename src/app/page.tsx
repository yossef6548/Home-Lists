"use client";

import { useState, useCallback, useMemo, memo } from "react";
import useSWR, { useSWRConfig } from "swr";
import { 
  getAppData, 
  addItemAction, 
  toggleItemAction, 
  clearCheckedAction, 
  deleteItemAction,
  moveItemAction
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
      processingItems: items.filter(i => i.name.startsWith("🔄 מעבד:")),
      tasks: items.filter(i => !i.name.startsWith("🔄 מעבד:") && i.type === "TASK"),
      shoppingItems: items.filter(i => !i.name.startsWith("🔄 מעבד:") && i.type === "SHOPPING")
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

  const handleMoveItem = useCallback(async (id: string, type: ItemType, categoryId: string | null = null) => {
    await moveItemAction(id, type, categoryId);
    refresh();
  }, [refresh]);

  return (
    <main className="min-h-screen bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 transition-colors duration-200 pb-10">
      <div className="max-w-md mx-auto px-3 py-6">
        <h1 className="text-2xl font-black text-center mb-6 tracking-tight text-blue-600 dark:text-blue-500 italic">
          Home Lists
        </h1>
        
        {/* Input Bar */}
        <form onSubmit={handleAddItem} className="mb-4 flex gap-2">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="מה להוסיף?"
            className="flex-1 p-3 bg-zinc-100 dark:bg-zinc-900 border-none rounded-xl shadow-inner focus:ring-2 focus:ring-blue-500/20 transition-all text-base"
            disabled={isAdding}
          />
          <button
            type="submit"
            className="bg-blue-600 text-white px-5 py-3 rounded-xl font-black shadow-lg shadow-blue-500/20 hover:bg-blue-700 active:scale-95 disabled:bg-zinc-400 transition-all text-sm"
            disabled={isAdding}
          >
            {isAdding ? "..." : "הוסף"}
          </button>
        </form>

        {/* Processing State Section */}
        <div className="flex flex-col gap-1.5 px-1 mb-6">
          {processingItems.map(item => (
            <div key={item.id} className="flex items-center gap-2 text-xs font-bold text-blue-500 animate-pulse">
              <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
              <span>{item.name}</span>
            </div>
          ))}
        </div>

        {/* Tab Switcher */}
        <div className="flex bg-zinc-100 dark:bg-zinc-900 p-1 rounded-xl mb-6 shadow-inner">
          <button
            onClick={() => setTab("TASK")}
            className={`flex-1 py-2 text-sm font-black rounded-lg transition-all ${
              tab === "TASK" 
                ? "bg-white dark:bg-zinc-800 shadow-sm text-blue-600 dark:text-blue-400" 
                : "text-zinc-400"
            }`}
          >
            משימות
          </button>
          <button
            onClick={() => setTab("SHOPPING")}
            className={`flex-1 py-2 text-sm font-black rounded-lg transition-all ${
              tab === "SHOPPING" 
                ? "bg-white dark:bg-zinc-800 shadow-sm text-blue-600 dark:text-blue-400" 
                : "text-zinc-400"
            }`}
          >
            קניות
          </button>
        </div>

        {/* Content Area */}
        {isLoading && !data ? (
          <div className="text-center py-10 opacity-20 font-black text-xs tracking-widest uppercase">Loading</div>
        ) : (
          <div className="space-y-4">
            {tab === "TASK" ? (
              <TaskList 
                items={tasks} 
                categories={data?.categories || []}
                onToggle={handleToggle} 
                onClear={async () => {
                  if (confirm("לנקות את כל המשימות שהושלמו?")) {
                    await clearCheckedAction("TASK");
                    refresh();
                  }
                }}
                onDelete={handleDelete}
                onMove={handleMoveItem}
              />
            ) : (
              <ShoppingList 
                items={shoppingItems} 
                categories={data?.categories || []}
                onToggle={handleToggle}
                onClear={async () => {
                  if (confirm("לנקות את כל הפריטים שנקנו?")) {
                    await clearCheckedAction("SHOPPING");
                    refresh();
                  }
                }}
                onDelete={handleDelete}
                onMove={handleMoveItem}
              />
            )}
          </div>
        )}
      </div>
    </main>
  );
}

const TaskList = memo(({ items, categories, onToggle, onClear, onDelete, onMove }: { 
  items: Item[], 
  categories: Category[],
  onToggle: (id: string, checked: boolean) => void,
  onClear: () => void,
  onDelete: (id: string) => void,
  onMove: (id: string, type: ItemType, categoryId: string | null) => void
}) => {
  const activeItems = useMemo(() => items.filter(i => !i.isChecked), [items]);
  const checkedItems = useMemo(() => items.filter(i => i.isChecked), [items]);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {activeItems.map(item => (
          <ItemRow key={item.id} item={item} categories={categories} onToggle={onToggle} onDelete={onDelete} onMove={onMove} />
        ))}
        {activeItems.length === 0 && (
          <div className="text-center py-10 text-zinc-300 dark:text-zinc-700 bg-zinc-50/50 dark:bg-zinc-900/30 rounded-2xl border-2 border-dashed border-zinc-100 dark:border-zinc-900 font-bold text-xs">
            אין משימות
          </div>
        )}
      </div>
      
      {checkedItems.length > 0 && (
        <div className="mt-8 border-t border-zinc-100 dark:border-zinc-900 pt-6">
          <button 
            onClick={onClear}
            className="w-full py-2 text-xs font-black text-zinc-400 dark:text-zinc-500 border border-zinc-100 dark:border-zinc-900 rounded-lg hover:bg-red-50 transition-all mb-4"
          >
            נקה משימות שהושלמו
          </button>
          <div className="space-y-2 opacity-40 grayscale">
            {checkedItems.map(item => (
              <ItemRow key={item.id} item={item} categories={categories} onToggle={onToggle} onDelete={onDelete} onMove={onMove} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

const ItemRow = memo(({ item, categories, onToggle, onDelete, onMove }: { 
  item: Item, 
  categories: Category[],
  onToggle: (id: string, checked: boolean) => void,
  onDelete: (id: string) => void,
  onMove: (id: string, type: ItemType, categoryId: string | null) => void
}) => {
  const [showMoveMenu, setShowMoveMenu] = useState(false);
  const topLevelCategories = useMemo(() => categories.filter(c => !c.parentId), [categories]);

  return (
    <div className="flex flex-col bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-800/50 overflow-hidden">
      <div className="flex items-center gap-3 p-3">
        <input 
          type="checkbox" 
          checked={item.isChecked}
          onChange={(e) => onToggle(item.id, e.target.checked)}
          className="w-5 h-5 rounded-md border-2 border-zinc-200 dark:border-zinc-700 text-blue-600 focus:ring-0 appearance-none checked:bg-blue-600 checked:border-blue-600"
        />
        
        <span className={`flex-1 text-sm ${item.isChecked ? "line-through text-zinc-300 dark:text-zinc-700" : "font-bold text-zinc-800 dark:text-zinc-200"}`}>
          {item.name}
        </span>
        
        <div className="flex gap-1">
          <button 
            onClick={() => setShowMoveMenu(!showMoveMenu)}
            className="text-zinc-400 p-2 active:bg-zinc-100 dark:active:bg-zinc-800 rounded-lg"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M16 3h5v5"/><path d="M8 3H3v5"/><path d="M16 21h5v-5"/><path d="M8 21H3v-5"/><path d="m15 15 6 6"/><path d="m9 9-6-6"/><path d="m21 3-6 6"/><path d="m3 21 6-6"/></svg>
          </button>
          <button 
            onClick={() => onDelete(item.id)}
            className="text-zinc-400 p-2 active:bg-red-50 dark:active:bg-red-900/20 rounded-lg"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>
          </button>
        </div>
      </div>

      {showMoveMenu && (
        <div className="p-2 bg-zinc-50 dark:bg-zinc-800/50 border-t border-zinc-100 dark:border-zinc-800 flex flex-wrap gap-1">
          <button 
            onClick={() => { onMove(item.id, "TASK", null); setShowMoveMenu(false); }}
            className="px-2 py-1.5 bg-white dark:bg-zinc-900 rounded border border-zinc-200 dark:border-zinc-700 font-bold text-[10px]"
          >
            משימות
          </button>
          {topLevelCategories.map(cat => (
            <button 
              key={cat.id}
              onClick={() => { onMove(item.id, "SHOPPING", cat.id); setShowMoveMenu(false); }}
              className="px-2 py-1.5 bg-white dark:bg-zinc-900 rounded border border-zinc-200 dark:border-zinc-700 font-bold text-[10px]"
            >
              {cat.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
});

const ShoppingList = memo(({ items, categories, onToggle, onClear, onDelete, onMove }: { 
  items: Item[], 
  categories: Category[],
  onToggle: (id: string, checked: boolean) => void,
  onClear: () => void,
  onDelete: (id: string) => void,
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
    <div className="space-y-6">
      <div className="space-y-6">
        {categoriesWithItems.map(cat => (
          <CategoryView 
            key={cat.id} 
            category={cat} 
            allCategories={categories} 
            allItems={items} 
            onToggle={onToggle}
            onDelete={onDelete}
            onMove={onMove}
          />
        ))}
        
        {uncategorizedItems.some(i => !i.isChecked) && (
          <div className="space-y-2">
            <h3 className="text-[10px] font-black text-zinc-400 uppercase tracking-widest px-1">כללי</h3>
            <div className="space-y-2">
              {uncategorizedItems.filter(i => !i.isChecked).map(item => (
                <ItemRow key={item.id} item={item} categories={categories} onToggle={onToggle} onDelete={onDelete} onMove={onMove} />
              ))}
            </div>
          </div>
        )}

        {categoriesWithItems.length === 0 && uncategorizedItems.filter(i => !i.isChecked).length === 0 && (
          <div className="text-center py-10 text-zinc-300 dark:text-zinc-700 bg-zinc-50/50 dark:bg-zinc-900/30 rounded-2xl border-2 border-dashed border-zinc-100 dark:border-zinc-900 font-bold text-xs">
            רשימה ריקה
          </div>
        )}
      </div>

      {items.some(i => i.isChecked) && (
        <div className="mt-8 border-t border-zinc-100 dark:border-zinc-900 pt-6">
          <button 
            onClick={onClear}
            className="w-full py-2 text-xs font-black text-zinc-400 dark:text-zinc-500 border border-zinc-100 dark:border-zinc-900 rounded-lg hover:bg-red-50 transition-all mb-4"
          >
            נקה פריטים שנקנו
          </button>
          <div className="space-y-2 opacity-40 grayscale">
            {items.filter(i => i.isChecked).map(item => (
              <ItemRow key={item.id} item={item} categories={categories} onToggle={onToggle} onDelete={onDelete} onMove={onMove} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

const CategoryView = memo(({ category, allCategories, allItems, onToggle, onDelete, onMove }: { 
  category: Category, 
  allCategories: Category[], 
  allItems: Item[],
  onToggle: (id: string, checked: boolean) => void,
  onDelete: (id: string) => void,
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
    <div className="space-y-3 border-r-4 border-blue-500/10 pr-3">
      <h3 className="text-base font-black text-zinc-800 dark:text-zinc-100 tracking-tight">{category.name}</h3>
      <div className="space-y-2">
        {items.map(item => (
          <ItemRow key={item.id} item={item} categories={allCategories} onToggle={onToggle} onDelete={onDelete} onMove={onMove} />
        ))}
        {visibleSubCategories.map(sub => (
          <div key={sub.id} className="space-y-2 pt-1">
            <h4 className="text-[10px] font-black text-blue-500/60 uppercase tracking-widest px-1">{sub.name}</h4>
            {allItems.filter(i => i.categoryId === sub.id && !i.isChecked).map(item => (
              <ItemRow key={item.id} item={item} categories={allCategories} onToggle={onToggle} onDelete={onDelete} onMove={onMove} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
});
