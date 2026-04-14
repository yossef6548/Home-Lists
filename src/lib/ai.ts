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

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["TASK", "SHOPPING"],
          },
          storeName: {
            type: "string",
          },
          divisionName: {
            type: "string",
          },
          itemName: {
            type: "string",
          },
        },
        required: ["type", "storeName", "divisionName", "itemName"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
} as const;

const STORE_ALIASES: Record<string, string> = {
  "supermarket": "סופרמרקט",
  "market": "סופרמרקט",
  "grocery": "סופרמרקט",
  "groceries": "סופרמרקט",
  "pharmacy": "פארם",
  "drugstore": "פארם",
  "hardware": "טמבור",
  "home improvement": "טמבור",
  "electronics": "אלקטרוניקה",
  "electronic": "אלקטרוניקה",
  "home": "לבית",
  "house": "לבית",
  "other": "אחר",
};

const DIVISION_ALIASES: Record<string, string> = {
  "fruits and vegetables": "פירות וירקות",
  "fruit and vegetables": "פירות וירקות",
  "produce": "פירות וירקות",
  "dairy and eggs": "חלבי וביצים",
  "dairy": "חלבי וביצים",
  "meat and fish": "בשר ודגים",
  "meat": "בשר ודגים",
  "bakery": "מאפייה",
  "frozen": "קפואים",
  "frozen food": "קפואים",
  "canned and sauces": "שימורים ורטבים",
  "canned goods": "שימורים ורטבים",
  "sauces": "שימורים ורטבים",
  "drinks": "משקאות",
  "beverages": "משקאות",
  "cleaning and toiletries": "ניקיון וטואלטיקה",
  "cleaning": "ניקיון וטואלטיקה",
  "toiletries": "ניקיון וטואלטיקה",
  "grains and legumes": "דגנים וקטניות",
  "grains": "דגנים וקטניות",
  "legumes": "דגנים וקטניות",
  "snacks and sweets": "חטיפים ומתוקים",
  "snacks": "חטיפים ומתוקים",
  "sweets": "חטיפים ומתוקים",
  "medicine": "תרופות",
  "medicines": "תרופות",
  "beauty": "טיפוח ויופי",
  "beauty and care": "טיפוח ויופי",
  "babies": "תינוקות",
  "baby": "תינוקות",
  "health": "בריאות",
  "tools": "כלי עבודה",
  "electrical": "חשמל ותאורה",
  "lighting": "חשמל ותאורה",
  "paint and maintenance": "צבע ותחזוקה",
  "paint": "צבע ותחזוקה",
  "maintenance": "צבע ותחזוקה",
  "garden": "גינון",
  "gardening": "גינון",
  "computers": "מחשבים",
  "computer": "מחשבים",
  "mobile": "סלולר",
  "cellular": "סלולר",
  "phone": "סלולר",
  "accessories": "אביזרים",
  "home goods": "כלי בית",
  "kitchenware": "כלי בית",
  "textiles": "טקסטיל",
  "furniture": "ריהוט",
  "general": "כללי",
};

function normalizeKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/["'`]/g, "")
    .replace(/\s+/g, " ");
}

function sanitizeItemName(value: string): string {
  return value
    .replace(/[\\"]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function getFixedHierarchy(): Hierarchy {
  try {
    const configPath = path.join(process.cwd(), "categories.json");
    const content = fs.readFileSync(configPath, "utf-8");
    return JSON.parse(content) as Hierarchy;
  } catch {
    return { "אחר": ["כללי"] };
  }
}

export function clearCategoryCache() {}

function normalizeStoreName(raw: string, hierarchy: Hierarchy): string {
  const directMap = new Map<string, string>();

  for (const storeName of Object.keys(hierarchy)) {
    directMap.set(normalizeKey(storeName), storeName);
  }

  const normalized = normalizeKey(raw);
  return (
    directMap.get(normalized) ||
    directMap.get(normalizeKey(STORE_ALIASES[normalized] || "")) ||
    "אחר"
  );
}

function normalizeDivisionName(
  raw: string,
  storeName: string,
  hierarchy: Hierarchy
): string {
  const validDivisions = hierarchy[storeName] || ["כללי"];
  const divisionMap = new Map<string, string>();

  for (const divisionName of validDivisions) {
    divisionMap.set(normalizeKey(divisionName), divisionName);
  }

  const normalized = normalizeKey(raw);
  const aliased = DIVISION_ALIASES[normalized] || "";

  return (
    divisionMap.get(normalized) ||
    divisionMap.get(normalizeKey(aliased)) ||
    (validDivisions.includes("כללי") ? "כללי" : validDivisions[0])
  );
}

function finalizeAIItems(rawItems: unknown[], hierarchy: Hierarchy): AIItem[] {
  const result: AIItem[] = [];

  for (const rawItem of rawItems) {
    if (!rawItem || typeof rawItem !== "object") continue;

    const item = rawItem as Record<string, unknown>;

    const rawType = String(item.type || "TASK").toUpperCase();
    const type: "TASK" | "SHOPPING" =
      rawType === "SHOPPING" ? "SHOPPING" : "TASK";

    const itemName = sanitizeItemName(
      String(item.itemName || item.name || "")
    );

    if (!itemName) continue;

    if (type === "TASK") {
      result.push({
        type: "TASK",
        itemName,
        storeName: "",
        divisionName: "",
      });
      continue;
    }

    const normalizedStore = normalizeStoreName(
      String(item.storeName || ""),
      hierarchy
    );
    const normalizedDivision = normalizeDivisionName(
      String(item.divisionName || ""),
      normalizedStore,
      hierarchy
    );

    result.push({
      type: "SHOPPING",
      itemName,
      storeName: normalizedStore,
      divisionName: normalizedDivision,
    });
  }

  return result;
}

export async function processWithAI(text: string): Promise<AIResponse> {
  const cleanedText = text.trim();
  if (!cleanedText) {
    return { items: [] };
  }

  const hierarchy = getFixedHierarchy();
  const hierarchyLines = Object.entries(hierarchy)
    .map(([store, divs]) => `${store}: ${divs.join(", ")}`)
    .join("\n");

  const schemaString = JSON.stringify(OUTPUT_SCHEMA, null, 2);

  const systemPrompt = `
You extract shopping and task items from a Hebrew user message.

Return only JSON that matches the required schema.

Rules:
1. Split combined requests into separate items.
2. type = TASK for an action, chore, reminder, or thing to do.
3. type = SHOPPING for a product or thing to buy.
4. itemName must stay in Hebrew and should be based on the user's original wording.
5. Keep itemName short and clean.
6. For TASK: storeName = "" and divisionName = "".
7. For SHOPPING: storeName and divisionName must be chosen only from the allowed list.
8. Do not invent stores, divisions, products, or tasks.
9. Do not return explanations.

Allowed stores and divisions:
${hierarchyLines}

JSON schema:
${schemaString}
`.trim();

  try {
    const response = await fetch(`${process.env.OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OLLAMA_MODEL || "qwen3:1.7b",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: cleanedText },
        ],
        stream: false,
        format: OUTPUT_SCHEMA,
        options: {
          temperature: 0,
          num_ctx: 1024,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`AI request failed: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    const rawResponse = data?.message?.content ?? "";

    process.stdout.write(
      `\n[AI DEBUG] INPUT: ${cleanedText} | RAW: ${rawResponse}\n`
    );

    const parsed = JSON.parse(rawResponse);
    const rawItems = Array.isArray(parsed?.items) ? parsed.items : [];
    const finalized = finalizeAIItems(rawItems, hierarchy);

    return { items: finalized };
  } catch (err) {
    process.stderr.write(`[AI ERROR] ${String(err)}\n`);
    return {
      items: [
        {
          type: "TASK",
          itemName: `⚠️ ${cleanedText}`,
          divisionName: "",
          storeName: "",
        },
      ],
    };
  }
}

export async function categorizeSingleItem(
  itemName: string
): Promise<AIItem | null> {
  const res = await processWithAI(itemName);
  return res.items.length > 0 ? res.items[0] : null;
}
