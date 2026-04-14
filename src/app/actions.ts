"use server";

import prisma from "@/lib/prisma";
import { processWithAI, getFixedHierarchy, categorizeSingleItem, clearCategoryCache } from "@/lib/ai";
import { broadcastUpdate } from "@/lib/events";
import { ItemType } from "@prisma/client";
import { revalidatePath } from "next/cache";

// Global queue for background processing
declare global {
  var aiProcessingQueue: Promise<void> | undefined;
}

if (!globalThis.aiProcessingQueue) {
  globalThis.aiProcessingQueue = Promise.resolve();
}

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
    
    // 1. Create placeholder immediately for instant UI feedback
    const placeholder = await prisma.item.create({
      data: { name: `🔄 מעבד: ${rawText}`, type: "TASK" },
    });
    
    revalidatePath("/");
    broadcastUpdate();

    // 2. Run AI in the background WITHOUT 'await' so the user doesn't wait
    const processingTask = async () => {
      try {
        const aiResponse = await processWithAI(rawText);
        
        await prisma.$transaction(async (tx) => {
          for (const aiResult of aiResponse.items) {
            let categoryId: string | null = null;

            if (aiResult.type === "SHOPPING") {
              // Exact Hebrew matching from the static config
              const store = await tx.category.findFirst({ 
                where: { name: aiResult.storeName, parentId: null } 
              });
              if (store) {
                const division = await tx.category.findFirst({ 
                  where: { name: aiResult.divisionName, parentId: store.id } 
                });
                categoryId = division ? division.id : store.id;
              }
            }

            await tx.item.create({
              data: { 
                name: aiResult.itemName, 
                type: aiResult.type as ItemType, 
                categoryId 
              },
            });
          }
          // 3. Cleanup placeholder
          await tx.item.deleteMany({ where: { id: placeholder.id } });
        });
      } catch (error) {
        process.stderr.write(`[AI BACKGROUND ERROR] ${error}\n`);
        await prisma.item.updateMany({
          where: { id: placeholder.id },
          data: { name: rawText },
        });
      } finally {
        revalidatePath("/");
        broadcastUpdate();
      }
    };

    // Chain to the global queue but DO NOT await it here
    globalThis.aiProcessingQueue = globalThis.aiProcessingQueue!.then(processingTask).catch(() => {});

    return { success: true };
  } catch (error) {
    return { success: false };
  }
}

export async function renameItemAction(id: string, newName: string) {
  await prisma.item.update({ where: { id }, data: { name: newName } });
  revalidatePath("/");
  broadcastUpdate();
}

export async function toggleItemAction(id: string, isChecked: boolean) {
  await prisma.item.update({ where: { id }, data: { isChecked } });
  revalidatePath("/");
  broadcastUpdate();
}

export async function moveItemAction(id: string, type: ItemType, categoryId: string | null = null) {
  await prisma.item.update({ where: { id }, data: { type, categoryId } });
  revalidatePath("/");
  broadcastUpdate();
}

export async function moveTaskToShoppingAction(id: string) {
  const item = await prisma.item.findUnique({ where: { id } });
  if (!item) return;

  const originalName = item.name;
  await prisma.item.update({ where: { id }, data: { type: "SHOPPING", name: `🔄 מסווג: ${item.name}` } });
  revalidatePath("/");
  broadcastUpdate();

  const processingTask = async () => {
    try {
      const aiResult = await categorizeSingleItem(originalName);
      if (aiResult) {
        let categoryId: string | null = null;
        const store = await prisma.category.findFirst({ where: { name: aiResult.storeName, parentId: null } });
        if (store) {
          const division = await prisma.category.findFirst({ where: { name: aiResult.divisionName, parentId: store.id } });
          categoryId = division ? division.id : store.id;
        }
        await prisma.item.update({
          where: { id },
          data: { name: aiResult.itemName, categoryId }
        });
      } else {
        await prisma.item.update({ where: { id }, data: { name: originalName } });
      }
    } catch (err) {
      await prisma.item.update({ where: { id }, data: { name: originalName } });
    } finally {
      revalidatePath("/");
      broadcastUpdate();
    }
  };

  globalThis.aiProcessingQueue = globalThis.aiProcessingQueue!.then(processingTask).catch(() => {});
}

export async function clearCheckedAction(type: ItemType) {
  await prisma.item.deleteMany({ where: { type, isChecked: true } });
  revalidatePath("/");
  broadcastUpdate();
}

export async function deleteItemAction(id: string) {
  await prisma.item.deleteMany({ where: { id } });
  revalidatePath("/");
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
  revalidatePath("/");
  broadcastUpdate();
}
