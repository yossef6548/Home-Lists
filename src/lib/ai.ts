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

  const systemPrompt = `אתה עוזר חכם לניהול רשימות. 
התפקיד שלך הוא לנתח את הקלט ולפצל אותו לפריטים נפרדים.
חוקים:
1. פצל כל בקשה לפריט נפרד (למשל: "X וגם Y" -> 2 פריטים).
2. שמות עצם/קניות -> SHOPPING. פעולות/מטלות -> TASK.
3. תרגם ונסח לעברית קצרה.
4. החזר אך ורק JSON תקין במבנה: {"items": [{"type":"TASK"|"SHOPPING","categoryPath":["חנות","מחלקה"],"itemName":"שם פריט"}]}`;

  const userPrompt = `נתח ופצל את הטקסט הבא: "${text}"
היררכיית חנויות קיימת: ${JSON.stringify(categoryCache)}`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000);

    const response = await fetch(`${process.env.OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama3.1:8b", 
        system: systemPrompt,
        prompt: userPrompt,
        stream: false,
        format: "json",
        options: {
          temperature: 0.1,
        }
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) throw new Error("AI request failed");

    const data = await response.json();
    let rawResponse = data.response || "";
    
    // Log to stderr so it shows up in Docker logs
    process.stderr.write(`[AI RAW] ${rawResponse}\n`);

    const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      rawResponse = jsonMatch[0];
    }

    let parsed = JSON.parse(rawResponse);
    
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
    process.stderr.write(`[AI ERROR] ${err}\n`);
    return { items: [] }; 
  }
}
