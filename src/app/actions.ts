"use server";

import prisma from "@/lib/prisma";
import { processWithAI, getFixedHierarchy, categorizeSingleItem, clearCategoryCache } from "@/lib/ai";
import { broadcastUpdate } from "@/lib/events";
import { ItemType } from "@prisma/client";

let aiProcessingQueue = Promise.resolve();

// Ensures the hierarchy from JSON exists in the database
export async function ensureStaticHierarchy() {
  const hierarchy = getFixedHierarchy();
  for (const [storeName, divisions] of Object.entries(hierarchy)) {
    let store = await prisma.category.findFirst({ where: { name: storeName, parentId: null } });
    if (!store) {
      store = await prisma.category.create({ data: { name: storeName } });
    }

    for (const divName of divisions) {
      const exists = await prisma.category.findFirst({ where: { name: divName, parentId: store.id } });
      if (!exists) {
        await prisma.category.create({ data: { name: divName, parentId: store.id } });
      }
    }
  }
}

export async function addItemAction(rawText: string) {
  try {
    await ensureStaticHierarchy();
    const placeholder = await prisma.item.create({
      data: { name: `🔄 מעבד: ${rawText}`, type: "TASK" },
    });
    broadcastUpdate();

    aiProcessingQueue = aiProcessingQueue.then(async () => {
      try {
        const aiResponse = await processWithAI(rawText);
        await prisma.$transaction(async (tx) => {
          for (const aiResult of aiResponse.items) {
            let categoryId: string | null = null;
            if (aiResult.type === "SHOPPING") {
              const store = await tx.category.findFirst({ where: { name: aiResult.parentCategoryName, parentId: null } });
              if (store) {
                const division = await tx.category.findFirst({ where: { name: aiResult.categoryName, parentId: store.id } });
                categoryId = division ? division.id : store.id;
              }
            }
            await tx.item.create({
              data: { name: aiResult.itemName, type: aiResult.type as ItemType, categoryId },
            });
          }
          await tx.item.deleteMany({ where: { id: placeholder.id } });
        });
        broadcastUpdate();
      } catch (error) {
        console.error("[QUEUE ERROR]", error);
        await prisma.item.updateMany({
          where: { id: placeholder.id },
          data: { name: rawText },
        });
        broadcastUpdate();
      }
    });
    return { success: true };
  } catch (error) {
    console.error("addItemAction failure:", error);
    return { success: false };
  }
}

export async function renameItemAction(id: string, newName: string) {
  await prisma.item.update({ where: { id }, data: { name: newName } });
  broadcastUpdate();
}

export async function toggleItemAction(id: string, isChecked: boolean) {
  await prisma.item.update({ where: { id }, data: { isChecked } });
  broadcastUpdate();
}

export async function moveItemAction(id: string, type: ItemType, categoryId: string | null = null) {
  await prisma.item.update({ where: { id }, data: { type, categoryId } });
  broadcastUpdate();
}

// Special move for tasks: Auto-categorize with AI
export async function moveTaskToShoppingAction(id: string) {
  const item = await prisma.item.findUnique({ where: { id } });
  if (!item) return;

  // Optimistically set to shopping in "Other"
  await prisma.item.update({ where: { id }, data: { type: "SHOPPING", name: `🔄 מסווג: ${item.name}` } });
  broadcastUpdate();

  aiProcessingQueue = aiProcessingQueue.then(async () => {
    try {
      const aiResult = await categorizeSingleItem(item.name);
      if (aiResult) {
        let categoryId: string | null = null;
        const store = await prisma.category.findFirst({ where: { name: aiResult.parentCategoryName, parentId: null } });
        if (store) {
          const division = await prisma.category.findFirst({ where: { name: aiResult.categoryName, parentId: store.id } });
          categoryId = division ? division.id : store.id;
        }
        await prisma.item.update({
          where: { id },
          data: { name: aiResult.itemName, categoryId }
        });
      } else {
        await prisma.item.update({ where: { id }, data: { name: item.name } });
      }
      broadcastUpdate();
    } catch (err) {
      await prisma.item.update({ where: { id }, data: { name: item.name } });
      broadcastUpdate();
    }
  });
}

export async function clearCheckedAction(type: ItemType) {
  await prisma.item.deleteMany({ where: { type, isChecked: true } });
  broadcastUpdate();
}

export async function deleteItemAction(id: string) {
  await prisma.item.deleteMany({ where: { id } });
  broadcastUpdate();
}

export async function getAppData() {
  const [items, categories] = await Promise.all([
    prisma.item.findMany({ orderBy: [{ isChecked: "asc" }, { createdAt: "desc" }] }),
    prisma.category.findMany({ include: { children: true } }),
  ]);
  return { items, categories };
}

export async function resetDatabaseFromConfig() {
  await prisma.$transaction([
    prisma.item.deleteMany(),
    prisma.category.deleteMany()
  ]);
  clearCategoryCache();
  await ensureStaticHierarchy();
  broadcastUpdate();
}
