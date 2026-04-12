import { eventEmitter } from "@/lib/events";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const encoder = new TextEncoder();
  
  const stream = new ReadableStream({
    start(controller) {
      const onUpdate = () => {
        try {
          controller.enqueue(encoder.encode(`data: update\n\n`));
        } catch (err) {
          console.error("SSE enqueue error:", err);
        }
      };

      eventEmitter.on("update", onUpdate);

      req.signal.onabort = () => {
        eventEmitter.off("update", onUpdate);
        controller.close();
      };
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-store, no-transform",
      Connection: "keep-alive",
    },
  });
}
