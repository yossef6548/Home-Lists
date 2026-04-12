"use server";

import prisma from "@/lib/prisma";
import { processWithAI } from "@/lib/ai";
import { broadcastUpdate } from "@/lib/events";
import { ItemType } from "@prisma/client";

// Global sequential queue for AI processing
let aiProcessingQueue = Promise.resolve();

export async function addItemAction(rawText: string) {
  try {
    const placeholder = await prisma.item.create({
      data: {
        name: `🔄 מעבד: ${rawText}`,
        type: "TASK",
      },
    });
    
    broadcastUpdate();

    aiProcessingQueue = aiProcessingQueue.then(async () => {
      try {
        const aiResponse = await processWithAI(rawText);
        
        await prisma.$transaction(async (tx) => {
          for (const aiResult of aiResponse.items) {
            let categoryId: string | null = null;

            if (aiResult.type === "SHOPPING" && aiResult.categoryPath && aiResult.categoryPath.length > 0) {
              let parentId: string | null = null;
              for (const catName of aiResult.categoryPath) {
                let category = await tx.category.findFirst({
                  where: { name: catName, parentId: parentId },
                });

                if (!category) {
                  category = await tx.category.create({
                    data: { name: catName, parentId: parentId },
                  });
                }
                parentId = category.id;
                categoryId = category.id;
              }
            }

            await tx.item.create({
              data: {
                name: aiResult.itemName,
                type: aiResult.type as ItemType,
                categoryId: categoryId,
              },
            });
          }
          
          // Use deleteMany to avoid P2025 if already deleted
          await tx.item.deleteMany({ where: { id: placeholder.id } });
        });

        broadcastUpdate();
      } catch (error) {
        console.error("AI background error:", error);
        // Only update if it still exists
        await prisma.item.updateMany({
          where: { id: placeholder.id, name: { startsWith: "🔄 מעבד:" } },
          data: { name: rawText },
        });
        broadcastUpdate();
      }
    });

    return { success: true };
  } catch (error) {
    console.error("addItemAction failure:", error);
    return { success: false, error: "Internal server error" };
  }
}

export async function toggleItemAction(id: string, isChecked: boolean) {
  await prisma.item.update({
    where: { id },
    data: { isChecked },
  });
  broadcastUpdate();
}

export async function clearCheckedAction(type: ItemType) {
  await prisma.item.deleteMany({
    where: { type, isChecked: true },
  });
  await cleanupEmptyCategories();
  broadcastUpdate();
}

export async function deleteItemAction(id: string) {
  await prisma.item.delete({
    where: { id },
  });
  await cleanupEmptyCategories();
  broadcastUpdate();
}

async function cleanupEmptyCategories() {
  try {
    const emptyCategories = await prisma.category.findMany({
      where: {
        items: { none: {} },
        children: { none: {} },
      },
    });

    if (emptyCategories.length > 0) {
      for (const cat of emptyCategories) {
        // Double check it's still empty to avoid race conditions
        const count = await prisma.item.count({ where: { categoryId: cat.id } });
        const subCount = await prisma.category.count({ where: { parentId: cat.id } });
        if (count === 0 && subCount === 0) {
          await prisma.category.delete({ where: { id: cat.id } }).catch(() => {});
        }
      }
      await cleanupEmptyCategories();
    }
  } catch (err) {
    console.error("Cleanup error:", err);
  }
}

export async function manualAddItemAction(name: string, type: ItemType, categoryId?: string) {
  await prisma.item.create({
    data: {
      name,
      type,
      categoryId: categoryId || null,
    },
  });
  broadcastUpdate();
}

export async function createCategoryAction(name: string, parentId?: string) {
  await prisma.category.create({
    data: {
      name,
      parentId: parentId || null,
    },
  });
  broadcastUpdate();
}

export async function deleteCategoryAction(id: string) {
  await prisma.$transaction([
    prisma.item.updateMany({ where: { categoryId: id }, data: { categoryId: null } }),
    prisma.category.updateMany({ where: { parentId: id }, data: { parentId: null } }),
    prisma.category.delete({ where: { id } }),
  ]);
  broadcastUpdate();
}

export async function getAppData() {
  const [items, categories] = await Promise.all([
    prisma.item.findMany({
      orderBy: [{ isChecked: "asc" }, { order: "asc" }, { createdAt: "desc" }],
    }),
    prisma.category.findMany({
      orderBy: { order: "asc" },
    }),
  ]);
  return { items, categories };
}
