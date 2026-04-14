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

export async function processWithAI(text: string): Promise<AIResponse> {
  const hierarchy = getFixedHierarchy();
  const hierarchyLines = Object.entries(hierarchy)
    .map(([store, divs]) => `${store}: ${divs.join(", ")}`)
    .join("\n");

  const systemPrompt = `You are a smart list assistant. Reply ONLY with valid JSON, no extra text.

Rules:
- Split combined requests ("X and Y") into separate items.
- type "TASK" = an action/chore (e.g. "לשטוף", "לתקן"). storeName and divisionName = "".
- type "SHOPPING" = a product to buy. Pick storeName and divisionName from the list below EXACTLY as written.
- itemName MUST always be the full Hebrew word(s) the user said. Never leave it empty.
- No backslashes inside string values. No trailing commas.

Allowed stores and divisions:
${hierarchyLines}

Output format (strict):
{"items":[{"type":"TASK","storeName":"","divisionName":"","itemName":"the task that the user mentioned"}]}
{"items":[{"type":"SHOPPING","storeName":"from allowed stores","divisionName":"from allowed divisons","itemName":"the item that the user want to shop"}]}

Example:
User: "אין חלב ויש כלים מלוכלכים בכיור"
Answer: {"items":[{"type":"SHOPPING","storeName":"סופרמרקט","divisionName":"חלבי וביצים","itemName":"חלב"},{"type":"TASK","storeName":"","divisionName":"","itemName":"לשטוף כלים"}]}`;

  try {
    const response = await fetch(`${process.env.OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "qwen2.5:0.5b", 
        system: systemPrompt,
        prompt: `נתח את הטקסט הבא: "${text}"`,
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

    const finalized = rawItems.filter((i: any) => i && (i.itemName || i.name)).map(i => ({
      type: (i.type || "TASK").toUpperCase() as any,
      itemName: i.itemName || i.name,
      divisionName: i.divisionName || "",
      storeName: i.storeName || ""
    }));

    return { items: finalized };
  } catch (err) {
    process.stderr.write(`[AI ERROR] ${err}\n`);
    return { items: [{ type: "TASK", itemName: `⚠️ ${text}`, divisionName: "", storeName: "" }] };
  }
}

export async function categorizeSingleItem(itemName: string): Promise<AIItem | null> {
  const res = await processWithAI(itemName);
  return res.items.length > 0 ? res.items[0] : null;
}
