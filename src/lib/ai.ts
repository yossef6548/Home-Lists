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

export function clearCategoryCache() {}

export async function processWithAI(text: string): Promise<AIResponse> {
  const hierarchy = getFixedHierarchy();
  
  const systemPrompt = `אתה עוזר חכם לניהול רשימות. עליך לבצע את הפעולות הבאות צעד אחר צעד:

1. **Understand**: הבן את כוונת המשתמש בטקסט.
2. **Analyze**: זהה את כל הבקשות השונות בטקסט (פצל "X וגם Y" ל-2 פריטים).
3. **Isolate**: הפרד בין מטלות (TASK - פעולות כמו לשטוף, לתקן) לבין קניות (SHOPPING - שמות עצם כמו חלב, לחם). פריט בודד כמו "מחשב" הוא תמיד SHOPPING.
4. **Locate**: עבור כל פריט SHOPPING, מצא את ה-"חנות" וה-"מחלקה" המתאימים ביותר אך ורק מתוך הרשימה למטה.

היררכיה מותרת (חנות -> מחלקות):
${Object.entries(hierarchy).map(([store, divs]) => `- ${store}: ${divs.join(", ")}`).join("\n")}

חוקים נוקשים:
- אל תשמיט אותיות! לחם = "לחם" (לא "חם"), לשטוף = "לשטוף" (לא "שטוף").
- החזר אך ורק JSON תקין.
- השתמש בשמות הקטגוריות בדיוק כפי שהם מופיעים למעלה (בעברית).

JSON FORMAT:
{"items": [{"type": "TASK"|"SHOPPING", "parentCategoryName": "שם החנות", "categoryName": "שם המחלקה", "itemName": "שם הפריט בעברית"}]}
`;

  try {
    const response = await fetch(`${process.env.OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "qwen2.5:7b-instruct", 
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
      categoryName: i.categoryName || "",
      parentCategoryName: i.parentCategoryName || ""
    }));

    return { items: finalized };
  } catch (err) {
    process.stderr.write(`[AI ERROR] ${err}\n`);
    return { items: [] }; 
  }
}

export async function categorizeSingleItem(itemName: string): Promise<AIItem | null> {
  const res = await processWithAI(itemName);
  return res.items.length > 0 ? res.items[0] : null;
}
