"use server";

import prisma from "@/lib/prisma";
import { processWithAI } from "@/lib/ai";
import { broadcastUpdate } from "@/lib/events";
import { ItemType } from "@prisma/client";

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
        
        if (!aiResponse.items || aiResponse.items.length === 0) {
          throw new Error("Empty AI response");
        }

        await prisma.$transaction(async (tx) => {
          for (const aiResult of aiResponse.items) {
            let categoryId: string | null = null;

            if (aiResult.type === "SHOPPING" && aiResult.categoryPath && aiResult.categoryPath.length > 0) {
              let parentId: string | null = null;
              for (const catName of aiResult.categoryPath) {
                let category: { id: string } | null = await tx.category.findFirst({
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
          await tx.item.deleteMany({ where: { id: placeholder.id } });
        });

        broadcastUpdate();
      } catch (error) {
        console.error("[QUEUE ERROR]", error);
        // On error, convert placeholder to a normal task with the original text
        await prisma.item.updateMany({
          where: { id: placeholder.id },
          data: { name: rawText },
        });
        broadcastUpdate();
      }
    });

    return { success: true };
  } catch (error) {
    console.error("addItemAction fatal failure:", error);
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

export async function moveItemAction(id: string, type: ItemType, categoryId: string | null = null) {
  await prisma.item.update({
    where: { id },
    data: { type, categoryId },
  });
  await cleanupEmptyCategories();
  broadcastUpdate();
}

export async function renameCategoryAction(id: string, name: string) {
  await prisma.category.update({
    where: { id },
    data: { name },
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
  await prisma.item.deleteMany({
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
        const count = await prisma.item.count({ where: { categoryId: cat.id } });
        const subCount = await prisma.category.count({ where: { parentId: cat.id } });
        if (count === 0 && subCount === 0) {
          await prisma.category.deleteMany({ where: { id: cat.id } });
        }
      }
      await cleanupEmptyCategories();
    }
  } catch (err) {
    console.error("Cleanup error:", err);
  }
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

export async function deleteCategoryAction(id: string) {
  await prisma.$transaction([
    prisma.item.updateMany({ where: { categoryId: id }, data: { categoryId: null } }),
    prisma.category.updateMany({ where: { parentId: id }, data: { parentId: null } }),
    prisma.category.deleteMany({ where: { id } }),
  ]);
  broadcastUpdate();
}
