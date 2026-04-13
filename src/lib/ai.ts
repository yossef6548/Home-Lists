import prisma from "./prisma";
import fs from "fs";
import path from "path";

export interface AIItem {
  type: "TASK" | "SHOPPING";
  categoryName: string; 
  parentCategoryName: string;
  itemName: string;
}

export interface AIResponse {
  items: AIItem[];
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

// Normalization map for common AI hallucinations
const CATEGORY_MAP: Record<string, string> = {
  "SUPERMARKET": "סופרמרקט",
  "Supermarket": "סופרמרקט",
  "PHARM": "פארם",
  "Pharm": "פארם",
  "ELECTRONICS": "אלקטרוניקה",
  "Electronics": "אלקטרוניקה",
  "TAMBOUR": "טמבור",
  "Tambour": "טמבור",
  "HOME": "לבית",
  "Home": "לבית"
};

export function clearCategoryCache() {}

export async function processWithAI(text: string): Promise<AIResponse> {
  const hierarchy = getFixedHierarchy();
  
  const systemPrompt = `You are a professional list manager. 
Categorize items into this FIXED HEBREW HIERARCHY.

HIERARCHY:
${JSON.stringify(hierarchy, null, 2)}

STRICT RULES:
1. "parentCategoryName" MUST be the Hebrew store name (e.g. "סופרמרקט").
2. "categoryName" MUST be the Hebrew division name (e.g. "חלבי וביצים").
3. DO NOT USE ENGLISH names like "SUPERMARKET".
4. Translate items to concise Hebrew (e.g. "milk" -> "חלב").

JSON FORMAT:
{"items": [{"type": "TASK"|"SHOPPING", "parentCategoryName": "Hebrew Store", "categoryName": "Hebrew Division", "itemName": "Hebrew Name"}]}
`;

  try {
    const response = await fetch(`${process.env.OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "qwen2.5:7b-instruct", 
        system: systemPrompt,
        prompt: `Categorize: "${text}"`,
        stream: false,
        format: "json",
        options: { temperature: 0 }
      }),
    });

    if (!response.ok) throw new Error("AI request failed");

    const data = await response.json();
    let rawResponse = data.response || "";
    
    process.stdout.write(`\n[AI DEBUG] INPUT: ${text} | RAW: ${rawResponse}\n`);

    const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) rawResponse = jsonMatch[0];

    const parsed = JSON.parse(rawResponse);
    let rawItems: any[] = Array.isArray(parsed.items) ? parsed.items : (Array.isArray(parsed) ? parsed : [parsed]);

    const finalized = rawItems.filter((i: any) => i && (i.itemName || i.name)).map(i => {
      let store = i.parentCategoryName || i.storeName || "";
      let division = i.categoryName || i.divisionName || "";
      
      // Apply normalization
      if (CATEGORY_MAP[store]) store = CATEGORY_MAP[store];
      
      return {
        type: (i.type || "TASK").toUpperCase() as any,
        itemName: i.itemName || i.name,
        categoryName: division,
        parentCategoryName: store
      };
    });

    return { items: finalized };
  } catch (err) {
    process.stdout.write(`[AI ERROR] ${err}\n`);
    return { items: [] }; 
  }
}

export async function categorizeSingleItem(itemName: string): Promise<AIItem | null> {
  const res = await processWithAI(itemName);
  return res.items.length > 0 ? res.items[0] : null;
}
