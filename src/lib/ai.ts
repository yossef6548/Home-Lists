import prisma from "./prisma";

export interface AIItem {
  type: "TASK" | "SHOPPING";
  categoryPath?: string[];
  itemName: string;
}

export interface AIResponse {
  items: AIItem[];
}

let categoryCache: any = null;
let lastCacheUpdate = 0;
const CACHE_TTL = 30000;

export async function processWithAI(text: string): Promise<AIResponse> {
  const now = Date.now();
  if (!categoryCache || (now - lastCacheUpdate) > CACHE_TTL) {
    const categories = await prisma.category.findMany({ include: { children: true } });
    categoryCache = categories
      .filter((c) => !c.parentId)
      .map((c) => ({
        חנות: c.name,
        מחלקות: c.children.map((child) => child.name),
      }));
    lastCacheUpdate = now;
  }

  const prompt = `נתח את הטקסט ופרק אותו לרשימה של פריטים נפרדים.
קלט: "${text}"

חוקים נוקשים:
1. חובה לפצל כל בקשה לפריט נפרד במערך ה-JSON. (למשל: "לחם וחלב" -> 2 פריטים נפרדים).
2. שמות עצם או קניות -> SHOPPING.
3. פעולות או מטלות -> TASK.
4. שים לב: "לשטוף כלים" הוא TASK (מטלה), לא SHOPPING.
5. כל פריט בשורה נפרדת בתוך המערך.

דוגמה למבנה המצופה:
{
  "items": [
    {"type": "TASK", "itemName": "לשטוף כלים"},
    {"type": "SHOPPING", "itemName": "לחם", "categoryPath": ["סופרמרקט", "מאפייה"]},
    {"type": "SHOPPING", "itemName": "חלב", "categoryPath": ["סופרמרקט", "מוצרי חלב"]}
  ]
}

היררכיית חנויות קיימת: ${JSON.stringify(categoryCache)}
החזר אך ורק JSON תקין.
`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45000); // 45 sec timeout

    const response = await fetch(`${process.env.OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gemma4:latest", 
        prompt: prompt,
        stream: false,
        format: "json",
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) throw new Error("AI request failed");

    const data = await response.json();
    console.error(`[AI DEBUG] Input: ${text} | Output: ${data.response}`);

    let parsed = JSON.parse(data.response);
    
    let items: AIItem[] = [];
    if (parsed.items && Array.isArray(parsed.items)) {
      items = parsed.items;
    } else if (Array.isArray(parsed)) {
      items = parsed;
    } else {
      items = [parsed];
    }

    return { items: items.filter((i: any) => i && i.itemName) };
  } catch (err) {
    console.error(`[AI ERROR] ${err}`);
    return { items: [] }; // Return empty list to trigger fallback in action
  }
}
