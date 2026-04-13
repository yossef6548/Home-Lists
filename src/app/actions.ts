"use server";

import prisma from "@/lib/prisma";
import { processWithAI, FIXED_HIERARCHY } from "@/lib/ai";
import { broadcastUpdate } from "@/lib/events";
import { ItemType } from "@prisma/client";

let aiProcessingQueue = Promise.resolve();

// Seed function to ensure the hierarchy is perfect
export async function ensureStaticHierarchy() {
  for (const [storeName, divisions] of Object.entries(FIXED_HIERARCHY)) {
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

            if (aiResult.type === "SHOPPING") {
              const store = await tx.category.findFirst({ where: { name: aiResult.parentCategoryName, parentId: null } });
              if (store) {
                const division = await tx.category.findFirst({ where: { name: aiResult.categoryName, parentId: store.id } });
                categoryId = division ? division.id : store.id;
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

export async function toggleItemAction(id: string, isChecked: boolean) {
  await prisma.item.update({ where: { id }, data: { isChecked } });
  broadcastUpdate();
}

export async function moveItemAction(id: string, type: ItemType, categoryId: string | null = null) {
  await prisma.item.update({ where: { id }, data: { type, categoryId } });
  broadcastUpdate();
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
    prisma.category.findMany({ orderBy: { name: "asc" } }),
  ]);
  return { items, categories };
}
