import fs from "fs";
import path from "path";

export interface AIItem {
  type: "TASK" | "SHOPPING";
  divisionName: string;
  storeName: string;
  itemName: string;
}

export interface AIResponse {
  items: AIItem[];
}

type Hierarchy = Record<string, string[]>;

export type AIProgressEvent =
  | { stage: "SPLITTING_START" }
  | { stage: "SPLITTING_DONE"; isolatedItems: string[] }
  | { stage: "CLASSIFYING"; index: number; itemText: string }
  | { stage: "TASK_REPHRASING"; index: number; itemText: string }
  | { stage: "SHOPPING_CATEGORIZING"; index: number; itemText: string };

function buildStringArraySchema() {
  return {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: { type: "string" },
      },
    },
    required: ["items"],
    additionalProperties: false,
  } as const;
}

function buildTypeSchema() {
  return {
    type: "object",
    properties: {
      type: {
        type: "string",
        enum: ["TASK", "SHOPPING"],
      },
    },
    required: ["type"],
    additionalProperties: false,
  } as const;
}

function buildTaskRephraseSchema() {
  return {
    type: "object",
    properties: {
      itemName: { type: "string" },
    },
    required: ["itemName"],
    additionalProperties: false,
  } as const;
}

function buildShoppingCategorySchema() {
  return {
    type: "object",
    properties: {
      storeName: { type: "string" },
      divisionName: { type: "string" },
      itemName: { type: "string" },
    },
    required: ["storeName", "divisionName", "itemName"],
    additionalProperties: false,
  } as const;
}

function normalizeLoose(value: string): string {
  return value
    .trim()
    .replace(/["'`׳״]/g, "")
    .replace(/\s+/g, " ");
}

function sanitizeItemName(value: string): string {
  return normalizeLoose(value).replace(/[\\]/g, "");
}

async function callOllamaJSON<T>({
  systemPrompt,
  userPrompt,
  schema,
}: {
  systemPrompt: string;
  userPrompt: string;
  schema: Record<string, unknown>;
}): Promise<T> {
  const response = await fetch(`${process.env.OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OLLAMA_MODEL || "qwen3:1.7b",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      stream: false,
      format: schema,
      options: {
        temperature: 0,
        num_ctx: 1024,
      },
    }),
  });

  if (!response.ok) throw new Error("AI request failed");
  const data = await response.json();
  const rawResponse = data?.message?.content || "";
  process.stdout.write(`\n[AI DEBUG] INPUT: ${userPrompt} | RAW: ${rawResponse}\n`);
  return JSON.parse(rawResponse) as T;
}

export function getFixedHierarchy(): Record<string, string[]> {
  try {
    const configPath = path.join(process.cwd(), "categories.json");
    const content = fs.readFileSync(configPath, "utf-8");
    return JSON.parse(content);
  } catch {
    return { "אחר": ["כללי"] };
  }
}

export function clearCategoryCache() {}

function resolveStoreName(rawStoreName: string, hierarchy: Hierarchy): string {
  const normalizedInput = normalizeLoose(rawStoreName);
  if (!normalizedInput) return "";

  for (const storeName of Object.keys(hierarchy)) {
    if (normalizeLoose(storeName) === normalizedInput) {
      return storeName;
    }
  }

  return "";
}

function resolveDivisionName(
  rawDivisionName: string,
  storeName: string,
  hierarchy: Hierarchy
): string {
  const divisions = hierarchy[storeName] || [];
  const normalizedInput = normalizeLoose(rawDivisionName);

  if (normalizedInput) {
    for (const divisionName of divisions) {
      if (normalizeLoose(divisionName) === normalizedInput) {
        return divisionName;
      }
    }
  }

  if (divisions.includes("כללי")) return "כללי";
  return divisions[0] || "";
}

function getFallbackStoreAndDivision(hierarchy: Hierarchy): {
  storeName: string;
  divisionName: string;
} {
  if (hierarchy["אחר"]) {
    return {
      storeName: "אחר",
      divisionName: hierarchy["אחר"].includes("כללי")
        ? "כללי"
        : hierarchy["אחר"][0] || "",
    };
  }

  const firstStore = Object.keys(hierarchy)[0] || "";
  return {
    storeName: firstStore,
    divisionName: firstStore ? hierarchy[firstStore]?.[0] || "" : "",
  };
}

function finalizeAIItems(rawItems: unknown, hierarchy: Hierarchy): AIItem[] {
  const itemsArray = Array.isArray(rawItems) ? rawItems : [];
  const fallback = getFallbackStoreAndDivision(hierarchy);

  const finalized = itemsArray
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    .map((item) => {
      const type = String(item.type || "TASK").toUpperCase() === "SHOPPING"
        ? "SHOPPING"
        : "TASK";

      const itemName = sanitizeItemName(String(item.itemName || item.name || ""));
      if (!itemName) return null;

      if (type === "TASK") {
        return {
          type: "TASK" as const,
          storeName: "",
          divisionName: "",
          itemName,
        };
      }

      const resolvedStore = resolveStoreName(String(item.storeName || ""), hierarchy);
      const storeName = resolvedStore || fallback.storeName;
      const divisionName = resolveDivisionName(
        String(item.divisionName || ""),
        storeName,
        hierarchy
      ) || fallback.divisionName;

      return {
        type: "SHOPPING" as const,
        storeName,
        divisionName,
        itemName,
      };
    })
    .filter((item): item is AIItem => item !== null);

  return finalized;
}

async function isolateItems(text: string): Promise<string[]> {
  const parsed = await callOllamaJSON<{ items: string[] }>({
    systemPrompt: `You split Hebrew user text into isolated list items.
Reply ONLY with valid JSON.
Rules:
- Split compound requests to atomic items.
- Keep items in Hebrew.
- Keep each item short and clean.
- Do not classify, do not add categories, do not add extra commentary.
- Keep original meaning only.
- If there is only one item, return one-element array.`,
    userPrompt: text,
    schema: buildStringArraySchema(),
  });

  const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
  const cleaned = rawItems.map(sanitizeItemName).filter(Boolean);
  return cleaned.length > 0 ? cleaned : [sanitizeItemName(text)].filter(Boolean);
}

async function classifyIsolatedItem(text: string): Promise<"TASK" | "SHOPPING"> {
  const parsed = await callOllamaJSON<{ type: "TASK" | "SHOPPING" }>({
    systemPrompt: `Classify ONE Hebrew item.
Reply ONLY with valid JSON: {"type":"TASK"} or {"type":"SHOPPING"}.
Rules:
- TASK = action/chore/thing to do.
- SHOPPING = product/thing to buy.`,
    userPrompt: text,
    schema: buildTypeSchema(),
  });

  return parsed.type === "SHOPPING" ? "SHOPPING" : "TASK";
}

async function rephraseTaskItem(text: string): Promise<string> {
  const parsed = await callOllamaJSON<{ itemName: string }>({
    systemPrompt: `Rewrite ONE Hebrew task into a concise imperative task phrase.
Reply ONLY with valid JSON.
Rules:
- Output in Hebrew.
- Keep it short and actionable.
- Example: "הבית שלנו מלוכלך" -> "לשטוף את הבית"
- Example: "שכחתי להתקשר לאמא" -> "להתקשר לאמא"`,
    userPrompt: text,
    schema: buildTaskRephraseSchema(),
  });

  return sanitizeItemName(parsed.itemName || text) || sanitizeItemName(text);
}

export async function categorizeShoppingItem(itemName: string): Promise<AIItem | null> {
  const hierarchy = getFixedHierarchy();
  const hierarchyLines = Object.entries(hierarchy)
    .map(([store, divs]) => `${store}: ${divs.join(", ")}`)
    .join("\n");

  const parsed = await callOllamaJSON<{
    storeName: string;
    divisionName: string;
    itemName: string;
  }>({
    systemPrompt: `Categorize ONE Hebrew shopping item.
Reply ONLY with valid JSON.
Rules:
- You must choose storeName/divisionName ONLY from the allowed hierarchy below, exactly as written.
- Keep itemName in Hebrew, short and clean.
- Do not invent stores or divisions.

Allowed stores and divisions:
${hierarchyLines}`,
    userPrompt: itemName,
    schema: buildShoppingCategorySchema(),
  });

  const fallback = getFallbackStoreAndDivision(hierarchy);
  const resolvedStore = resolveStoreName(String(parsed.storeName || ""), hierarchy);
  const storeName = resolvedStore || fallback.storeName;
  const divisionName = resolveDivisionName(
    String(parsed.divisionName || ""),
    storeName,
    hierarchy
  ) || fallback.divisionName;
  const safeItemName = sanitizeItemName(parsed.itemName || itemName) || sanitizeItemName(itemName);

  if (!safeItemName) return null;
  return {
    type: "SHOPPING",
    storeName,
    divisionName,
    itemName: safeItemName,
  };
}

export async function processWithAI(
  text: string,
  onProgress?: (event: AIProgressEvent) => Promise<void> | void
): Promise<AIResponse> {
  try {
    await onProgress?.({ stage: "SPLITTING_START" });
    const isolatedItems = await isolateItems(text);
    await onProgress?.({ stage: "SPLITTING_DONE", isolatedItems });

    const finalizedItems: AIItem[] = [];

    for (let index = 0; index < isolatedItems.length; index += 1) {
      const isolatedItem = isolatedItems[index];
      await onProgress?.({ stage: "CLASSIFYING", index, itemText: isolatedItem });
      const type = await classifyIsolatedItem(isolatedItem);

      if (type === "TASK") {
        await onProgress?.({ stage: "TASK_REPHRASING", index, itemText: isolatedItem });
        const taskName = await rephraseTaskItem(isolatedItem);
        finalizedItems.push({
          type: "TASK",
          storeName: "",
          divisionName: "",
          itemName: taskName,
        });
        continue;
      }

      await onProgress?.({ stage: "SHOPPING_CATEGORIZING", index, itemText: isolatedItem });
      const shopping = await categorizeShoppingItem(isolatedItem);
      if (shopping) finalizedItems.push(shopping);
    }

    return { items: finalizeAIItems(finalizedItems, getFixedHierarchy()) };
  } catch (err) {
    process.stderr.write(`[AI ERROR] ${err}\n`);
    return {
      items: [
        {
          type: "TASK",
          itemName: `⚠️ ${text}`,
          divisionName: "",
          storeName: "",
        },
      ],
    };
  }
}

export async function categorizeSingleItem(itemName: string): Promise<AIItem | null> {
  return categorizeShoppingItem(itemName);
}
