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
        store: c.name,
        sections: c.children.map((child) => child.name),
      }));
    lastCacheUpdate = now;
  }

  // Stronger, more explicit prompt for multi-item extraction and translation
  const prompt = `Analyze: "${text}". 
Instructions:
1. Identify EVERY distinct task or shopping item.
2. Translate and rephrase to concise Hebrew.
3. SHOPPING: Nouns (e.g. "out of milk", "need bread", "computer").
4. TASK: Actions (e.g. "clean", "fix", "call").
5. Categorize SHOPPING by Store Type -> Section.

Examples:
- "need to do the dishes and buy milk" -> 
  {"items": [{"type":"TASK","itemName":"לשטוף כלים"},{"type":"SHOPPING","itemName":"חלב","categoryPath":["סופרמרקט","מוצרי חלב"]}]}
- "out of bread and milk" -> 
  {"items": [{"type":"SHOPPING","itemName":"לחם","categoryPath":["סופרמרקט","מאפייה"]},{"type":"SHOPPING","itemName":"חלב","categoryPath":["סופרמרקט","מוצרי חלב"]}]}

Stores: ${JSON.stringify(categoryCache)}
Return ONLY JSON in format: {"items": [{"type":"TASK"|"SHOPPING","categoryPath":["Store","Section"],"itemName":"Name"}]}
`;

  const response = await fetch(`${process.env.OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gemma4:latest", 
      prompt: prompt,
      stream: false,
      format: "json",
    }),
  });

  if (!response.ok) throw new Error("AI request failed");

  const data = await response.json();
  console.log(`AI Result for [${text}]:`, data.response);

  let parsed;
  try {
    parsed = JSON.parse(data.response);
  } catch (e) {
    console.error("JSON Parse Error:", data.response);
    throw new Error("Invalid AI JSON");
  }
  
  // Normalize the response to always return the items array
  let items: AIItem[] = [];
  if (parsed.items && Array.isArray(parsed.items)) {
    items = parsed.items;
  } else if (Array.isArray(parsed)) {
    items = parsed;
  } else {
    items = [parsed];
  }

  return { items };
}
