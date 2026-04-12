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
  renameCategoryAction,
  deleteCategoryAction
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
    
    const tempId = Math.random().toString();
    mutate("app-data", {
      ...data,
      items: [{ id: tempId, name: `🔄 מעבד: ${text}`, type: "TASK", isChecked: false, categoryId: null, createdAt: new Date(), updatedAt: new Date(), order: 0 }, ...(data?.items || [])]
    }, false);

    try {
      await addItemAction(text);
      refresh();
    } catch (err) {
      console.error(err);
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
    <main className="min-h-screen bg-gray-50 dark:bg-zinc-950 text-gray-900 dark:text-zinc-100 transition-colors duration-200 pb-20">
      <div className="max-w-2xl mx-auto px-4 py-8">
        <h1 className="text-4xl font-black text-center mb-8 tracking-tight text-blue-600 dark:text-blue-500">
          Home Lists
        </h1>
        
        <form onSubmit={handleAddItem} className="mb-4 flex gap-2">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="מה להוסיף?"
            className="flex-1 p-4 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
            disabled={isAdding}
          />
          <button
            type="submit"
            className="bg-blue-600 text-white px-8 py-4 rounded-xl font-bold shadow-lg shadow-blue-500/20 hover:bg-blue-700 active:scale-95 disabled:bg-blue-400 transition-all"
            disabled={isAdding}
          >
            {isAdding ? "מוסיף..." : "הוסף"}
          </button>
        </form>

        <div className="min-h-[40px] mb-4 flex flex-col gap-1 px-1">
          {processingItems.map(item => (
            <div key={item.id} className="flex items-center gap-2 text-sm font-bold text-blue-500 animate-pulse">
              <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
              <span>{item.name}</span>
            </div>
          ))}
        </div>

        <div className="flex bg-gray-200/50 dark:bg-zinc-900/50 p-1 rounded-xl mb-8">
          <button
            onClick={() => setTab("TASK")}
            className={`flex-1 py-3 text-lg font-bold rounded-lg transition-all ${
              tab === "TASK" 
                ? "bg-white dark:bg-zinc-800 shadow-sm text-blue-600 dark:text-blue-400" 
                : "text-gray-500 hover:text-gray-700 dark:hover:text-zinc-300"
            }`}
          >
            משימות
          </button>
          <button
            onClick={() => setTab("SHOPPING")}
            className={`flex-1 py-3 text-lg font-bold rounded-lg transition-all ${
              tab === "SHOPPING" 
                ? "bg-white dark:bg-zinc-800 shadow-sm text-blue-600 dark:text-blue-400" 
                : "text-gray-500 hover:text-gray-700 dark:hover:text-zinc-300"
            }`}
          >
            רשימת קניות
          </button>
        </div>

        {isLoading && !data ? (
          <div className="text-center py-12 opacity-50 font-bold text-xl">טוען...</div>
        ) : (
          <div className="space-y-4">
            {tab === "TASK" ? (
              <TaskList 
                items={tasks} 
                categories={data?.categories || []}
                onToggle={handleToggle} 
                onClear={async () => {
                  await clearCheckedAction("TASK");
                  refresh();
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
                  await clearCheckedAction("SHOPPING");
                  refresh();
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
          <div className="text-center py-12 text-gray-400 dark:text-zinc-600 bg-white/50 dark:bg-zinc-900/50 rounded-2xl border-2 border-dashed border-gray-200 dark:border-zinc-800 font-bold">
            אין משימות פעילות
          </div>
        )}
      </div>
      
      {checkedItems.length > 0 && (
        <div className="mt-8 border-t border-gray-200 dark:border-zinc-800 pt-6">
          <button 
            onClick={onClear}
            className="w-full py-3 text-sm font-bold text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900/50 rounded-xl hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors mb-6"
          >
            נקה פריטים שסומנו
          </button>
          <div className="space-y-2 opacity-60">
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

  return (
    <div className="flex flex-col gap-2 p-4 bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-gray-100 dark:border-zinc-800 group transition-all hover:shadow-md relative">
      <div className="flex items-center gap-4">
        <input 
          type="checkbox" 
          checked={item.isChecked}
          onChange={(e) => onToggle(item.id, e.target.checked)}
          className="w-6 h-6 rounded-lg border-gray-300 dark:border-zinc-700 text-blue-600 focus:ring-blue-500 transition-all cursor-pointer"
        />
        <span className={`flex-1 text-lg ${item.isChecked ? "line-through text-gray-400 dark:text-zinc-600" : "font-bold"}`}>
          {item.name}
        </span>
        
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-all">
          <button 
            onClick={() => setShowMoveMenu(!showMoveMenu)}
            className="text-gray-400 hover:text-blue-500 p-2"
            title="העבר לרשימה אחרת"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 3h5v5"/><path d="M8 3H3v5"/><path d="M16 21h5v-5"/><path d="M8 21H3v-5"/><path d="m15 15 6 6"/><path d="m9 9-6-6"/><path d="m21 3-6 6"/><path d="m3 21 6-6"/></svg>
          </button>
          <button 
            onClick={() => onDelete(item.id)}
            className="text-gray-400 hover:text-red-500 p-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>
          </button>
        </div>
      </div>

      {showMoveMenu && (
        <div className="mt-3 p-3 bg-gray-50 dark:bg-zinc-800 rounded-lg border border-gray-200 dark:border-zinc-700 grid grid-cols-2 gap-2 text-sm">
          <button 
            onClick={() => { onMove(item.id, "TASK", null); setShowMoveMenu(false); }}
            className="p-2 bg-white dark:bg-zinc-900 rounded border hover:border-blue-500 font-bold"
          >
            משימות
          </button>
          {categories.filter(c => !c.parentId).map(cat => (
            <button 
              key={cat.id}
              onClick={() => { onMove(item.id, "SHOPPING", cat.id); setShowMoveMenu(false); }}
              className="p-2 bg-white dark:bg-zinc-900 rounded border hover:border-blue-500 font-bold truncate"
            >
              {cat.name}
            </button>
          ))}
          <button 
            onClick={() => {
              const name = prompt("שם קטגוריה חדשה:");
              if (name) {
                // Ideally create category then move, but simplified for now
                alert("אנא הוסף את הקטגוריה ידנית או דרך ה-AI");
              }
            }}
            className="p-2 bg-white dark:bg-zinc-900 rounded border border-dashed hover:border-blue-500 font-bold"
          >
            + קטגוריה
          </button>
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
  const uncategorizedItems = useMemo(() => items.filter(i => !i.categoryId), [items]);

  return (
    <div className="space-y-8">
      <div className="space-y-6">
        {topLevelCategories.map(cat => (
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
          <div className="space-y-3">
            <h3 className="text-xs font-black text-gray-400 dark:text-zinc-600 uppercase tracking-widest px-1">ללא קטגוריה</h3>
            <div className="space-y-2">
              {uncategorizedItems.filter(i => !i.isChecked).map(item => (
                <ItemRow key={item.id} item={item} categories={categories} onToggle={onToggle} onDelete={onDelete} onMove={onMove} />
              ))}
            </div>
          </div>
        )}

        {topLevelCategories.length === 0 && uncategorizedItems.length === 0 && (
          <div className="text-center py-12 text-gray-400 dark:text-zinc-600 bg-white/50 dark:bg-zinc-900/50 rounded-2xl border-2 border-dashed border-gray-200 dark:border-zinc-800 font-bold">
            רשימת הקניות ריקה
          </div>
        )}
      </div>

      {items.some(i => i.isChecked) && (
        <div className="mt-12 border-t border-gray-200 dark:border-zinc-800 pt-8">
          <button 
            onClick={onClear}
            className="w-full py-3 text-sm font-bold text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900/50 rounded-xl hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors mb-6"
          >
            נקה פריטים שסומנו
          </button>
          <div className="space-y-2 opacity-60">
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

  return (
    <div className="space-y-3 border-r-4 border-blue-100 dark:border-blue-900/30 pr-4 py-1">
      <div className="flex items-center justify-between group">
        <h3 className="text-xl font-black text-gray-800 dark:text-zinc-200">{category.name}</h3>
        <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-all">
          <button 
            onClick={async () => {
              const newName = prompt("שם קטגוריה חדש:", category.name);
              if (newName && newName !== category.name) {
                await renameCategoryAction(category.id, newName);
              }
            }}
            className="text-xs font-bold text-blue-500 hover:text-blue-700"
          >
            ערוך
          </button>
          <button 
            onClick={async () => {
              if (confirm(`האם למחוק את הקטגוריה "${category.name}"?`)) {
                await deleteCategoryAction(category.id);
              }
            }}
            className="text-xs font-bold text-red-400 hover:text-red-600"
          >
            מחק
          </button>
        </div>
      </div>
      <div className="space-y-2">
        {items.map(item => (
          <ItemRow key={item.id} item={item} categories={allCategories} onToggle={onToggle} onDelete={onDelete} onMove={onMove} />
        ))}
        {subCategories.map(sub => (
          <CategoryView 
            key={sub.id} 
            category={sub} 
            allCategories={allCategories} 
            allItems={allItems} 
            onToggle={onToggle}
            onDelete={onDelete}
            onMove={onMove}
          />
        ))}
      </div>
    </div>
  );
});
