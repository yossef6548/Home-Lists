import prisma from "./prisma";
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

function buildOutputSchema() {
  return {
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

export function getFixedHierarchy(): Record<string, string[]> {
  try {
    const configPath = path.join(process.cwd(), "categories.json");
    const content = fs.readFileSync(configPath, "utf-8");
    return JSON.parse(content);
  } catch (err) {
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

export async function processWithAI(text: string): Promise<AIResponse> {
  const hierarchy = getFixedHierarchy();
  const hierarchyLines = Object.entries(hierarchy)
    .map(([store, divs]) => `${store}: ${divs.join(", ")}`)
    .join("\n");

  const outputSchema = buildOutputSchema();

  const systemPrompt = `You are a smart list assistant.
Reply ONLY with valid JSON matching the required schema. No extra text.

Rules:
- Analyze the user message and split combined requests into separate items.
- For each item decide whether it is a TASK or SHOPPING item.
- TASK = an action, chore, or thing to do. For TASK always use storeName = "" and divisionName = "".
- SHOPPING = a product or thing to buy.
- For SHOPPING, storeName and divisionName must be chosen ONLY from the allowed stores and divisions below, exactly as written.
- itemName must never be empty.
- itemName must stay in Hebrew and should be based on the user's original wording.
- Keep itemName short and clean.
- Do not invent stores or divisions that are not in the list.
- Return JSON only.

Allowed stores and divisions:
${hierarchyLines}

Example:
User: "אין חלב ויש כלים מלוכלכים בכיור"
Answer:
{"items":[{"type":"SHOPPING","storeName":"סופרמרקט","divisionName":"חלבי וביצים","itemName":"חלב"},{"type":"TASK","storeName":"","divisionName":"","itemName":"לשטוף כלים"}]}`;

  try {
    const response = await fetch(`${process.env.OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OLLAMA_MODEL || "qwen3:1.7b",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: text },
        ],
        stream: false,
        format: outputSchema,
        options: {
          temperature: 0,
          num_ctx: 1024,
        },
      }),
    });

    if (!response.ok) throw new Error("AI request failed");

    const data = await response.json();
    let rawResponse = data?.message?.content || "";

    process.stdout.write(`\n[AI DEBUG] INPUT: ${text} | RAW: ${rawResponse}\n`);

    const parsed = JSON.parse(rawResponse);
    const finalized = finalizeAIItems(parsed.items, hierarchy);

    return { items: finalized };
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
  const res = await processWithAI(itemName);
  return res.items.length > 0 ? res.items[0] : null;
}