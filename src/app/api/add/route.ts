import { addItemAction } from "@/app/actions";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const text = body.text || body.input; // Support both common payload keys

    if (!text) {
      return NextResponse.json({ error: "No text provided" }, { status: 400 });
    }

    await addItemAction(text);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("API Error:", error);
    return NextResponse.json({ error: "Failed to process request" }, { status: 500 });
  }
}
