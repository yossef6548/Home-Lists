"use server";

import prisma from "@/lib/prisma";
import { processWithAI, getFixedHierarchy, categorizeSingleItem, clearCategoryCache } from "@/lib/ai";
import type { AIProgressEvent } from "@/lib/ai";
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
    const cleanedText = rawText.trim();
    if (!cleanedText) return { success: false };

    await ensureStaticHierarchy();
    
    // 1. Create placeholder immediately for instant UI feedback
    const placeholder = await prisma.item.create({
      data: { name: `🔄 מפצל: ${cleanedText}`, type: "TASK" },
    });
    
    revalidatePath("/");
    broadcastUpdate();

    // 2. Run AI in the background WITHOUT 'await' so the user doesn't wait
    const processingTask = async () => {
      const stageRowsByIndex = new Map<number, string>();
      let splitPlaceholderId: string | null = placeholder.id;

      const handleProgress = async (event: AIProgressEvent) => {
        switch (event.stage) {
          case "SPLITTING_START":
            if (splitPlaceholderId) {
              await prisma.item.updateMany({
                where: { id: splitPlaceholderId },
                data: { name: `🔄 מפצל: ${cleanedText}` },
              });
            }
            break;
          case "SPLITTING_DONE":
            if (splitPlaceholderId) {
              await prisma.item.deleteMany({ where: { id: splitPlaceholderId } });
              splitPlaceholderId = null;
            }

            for (let i = 0; i < event.isolatedItems.length; i += 1) {
              const item = await prisma.item.create({
                data: { name: `🔄 מסווג: ${event.isolatedItems[i]}`, type: "TASK" },
              });
              stageRowsByIndex.set(i, item.id);
            }
            break;
          case "CLASSIFYING":
            await prisma.item.updateMany({
              where: { id: stageRowsByIndex.get(event.index) || "" },
              data: { name: `🔄 מסווג: ${event.itemText}` },
            });
            break;
          case "TASK_REPHRASING":
            await prisma.item.updateMany({
              where: { id: stageRowsByIndex.get(event.index) || "" },
              data: { name: `🔄 מנסח: ${event.itemText}` },
            });
            break;
          case "SHOPPING_CATEGORIZING":
            await prisma.item.updateMany({
              where: { id: stageRowsByIndex.get(event.index) || "" },
              data: { name: `🔄 משייך: ${event.itemText}` },
            });
            break;
          default:
            break;
        }
        revalidatePath("/");
        broadcastUpdate();
      };

      try {
        const aiResponse = await processWithAI(cleanedText, handleProgress);
        const itemsToSave = aiResponse.items.length > 0
          ? aiResponse.items
          : [{ type: "TASK" as const, itemName: `⚠️ ${cleanedText}`, divisionName: "", storeName: "" }];

        await prisma.$transaction(async (tx) => {
          for (const aiResult of itemsToSave) {
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
          // 3. Cleanup placeholders
          await tx.item.deleteMany({
            where: {
              id: {
                in: [placeholder.id, ...Array.from(stageRowsByIndex.values())],
              },
            },
          });
        });
      } catch (error) {
        process.stderr.write(`[AI BACKGROUND ERROR] ${error}\n`);
        await prisma.item.deleteMany({ where: { id: { in: Array.from(stageRowsByIndex.values()) } } });
        if (splitPlaceholderId) {
          await prisma.item.updateMany({
            where: { id: splitPlaceholderId },
            data: { name: cleanedText },
          });
        } else {
          await prisma.item.create({
            data: { name: cleanedText, type: "TASK" },
          });
        }
      } finally {
        revalidatePath("/");
        broadcastUpdate();
      }
    };

    // Chain to the global queue but DO NOT await it here
    globalThis.aiProcessingQueue = globalThis.aiProcessingQueue!.then(processingTask).catch(() => {});

    return { success: true };
  } catch {
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
  await prisma.item.update({ where: { id }, data: { type: "SHOPPING", name: `🔄 משייך: ${item.name}` } });
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
    } catch {
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
