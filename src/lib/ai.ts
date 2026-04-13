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

// קריאה דינמית מהקונפיגורציה
export function getFixedHierarchy(): Record<string, string[]> {
  try {
    const configPath = path.join(process.cwd(), "categories.json");
    const content = fs.readFileSync(configPath, "utf-8");
    return JSON.parse(content);
  } catch (err) {
    console.error("Failed to load categories.json, using fallback", err);
    return { "אחר": ["כללי"] };
  }
}

let categoryCache: any = null;
let lastCacheUpdate = 0;
const CACHE_TTL = 30000;

export function clearCategoryCache() {
  categoryCache = null;
  lastCacheUpdate = 0;
}

export async function processWithAI(text: string): Promise<AIResponse> {
  const hierarchy = getFixedHierarchy();
  
  const systemPrompt = `אתה עוזר חכם לניהול רשימות. עליך לנתח את הטקסט ולפצל אותו לפריטים.
לכל פריט קניה, עליך לבחור את הקטגוריה והתת-קטגוריה המתאימים ביותר מהרשימה הסגורה בלבד.

רשימת קטגוריות מותרת (חנות -> מחלקות):
${Object.entries(hierarchy).map(([store, divs]) => `- ${store}: ${divs.join(", ")}`).join("\n")}

חוקים נוקשים:
- החזר אך ורק JSON תקין.
- אין להמציא קטגוריות חדשות. השתמש רק בקיימות.
- ניסוח: עברית קצרה ותקנית. אל תשמיט אותיות.
`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000);

    const response = await fetch(`${process.env.OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama3.1:8b", 
        system: systemPrompt,
        prompt: `נתח ופצל לעברית: "${text}"`,
        stream: false,
        format: "json",
        options: { temperature: 0 }
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    const data = await response.json();
    let rawResponse = data.response || "";
    const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) rawResponse = jsonMatch[0];

    const parsed = JSON.parse(rawResponse);
    const items = Array.isArray(parsed.items) ? parsed.items : [parsed];

    return { items: items.filter((i: any) => i && i.itemName) };
  } catch (err) {
    console.error("[AI ERROR]", err);
    return { items: [] }; 
  }
}

// פונקציה חדשה לסיווג פריט בודד (למשל במעבר ממשימה לקנייה)
export async function categorizeSingleItem(itemName: string): Promise<AIItem | null> {
  const res = await processWithAI(itemName);
  if (res.items && res.items.length > 0) {
    return res.items[0];
  }
  return null;
}
