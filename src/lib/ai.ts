import prisma from "./prisma";

export interface AIItem {
  type: "TASK" | "SHOPPING";
  categoryName: string; 
  parentCategoryName: string;
  itemName: string;
}

export interface AIResponse {
  items: AIItem[];
}

// המקור היחיד לאמת - היררכיה קבועה מראש
export const FIXED_HIERARCHY: Record<string, string[]> = {
  "סופרמרקט": ["פירות וירקות", "חלבי וביצים", "בשר ודגים", "מאפייה", "קפואים", "שימורים ורטבים", "משקאות", "ניקיון וטואלטיקה", "דגנים וקטניות", "חטיפים ומתוקים"],
  "פארם": ["תרופות", "טיפוח ויופי", "תינוקות", "בריאות"],
  "טמבור": ["כלי עבודה", "חשמל ותאורה", "צבע ותחזוקה", "גינון"],
  "אלקטרוניקה": ["מחשבים", "סלולר", "אביזרים"],
  "לבית": ["כלי בית", "טקסטיל", "ריהוט"],
  "אחר": ["כללי"]
};

export async function processWithAI(text: string): Promise<AIResponse> {
  const systemPrompt = `אתה עוזר חכם לניהול רשימות. עליך לבצע את המשימה לפי השלבים הבאים:

שלב 1 (Understand): הבן את כוונת המשתמש בטקסט הגולמי.
שלב 2 (Analyze): זהה את כל הבקשות השונות (פצל משפטים מורכבים לפריטים בודדים).
שלב 3 (Isolate): הפרד בין מטלות (TASK) לבין פריטי קנייה (SHOPPING). שמות עצם הם תמיד SHOPPING.
שלב 4 (Locate): עבור כל פריט SHOPPING, מצא את ה-"חנות" וה-"מחלקה" המתאימים ביותר מתוך הרשימה הסגורה למטה.

רשימת קטגוריות מותרת (חנות -> מחלקות):
${Object.entries(FIXED_HIERARCHY).map(([store, divs]) => `- ${store}: ${divs.join(", ")}`).join("\n")}

חוקים נוקשים:
- החזר אך ורק JSON תקין.
- אין להמציא קטגוריות חדשות. השתמש רק בקיימות.
- ניסוח: עברית קצרה ותקנית. אל תשמיט אותיות (למשל: "לחם" ולא "חם", "לשטוף" ולא "שטוף").

דוגמאות:
- "לקנות חלב ולשטוף כלים" -> {"items": [{"type":"SHOPPING", "parentCategoryName":"סופרמרקט", "categoryName":"חלבי וביצים", "itemName":"חלב"}, {"type":"TASK", "parentCategoryName":"", "categoryName":"", "itemName":"לשטוף כלים"}]}
- "צריך סוללות ומחשב" -> {"items": [{"type":"SHOPPING", "parentCategoryName":"טמבור", "categoryName":"חשמל ותאורה", "itemName":"סוללות"}, {"type":"SHOPPING", "parentCategoryName":"אלקטרוניקה", "categoryName":"מחשבים", "itemName":"מחשב"}]}
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
