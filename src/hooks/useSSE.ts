import { useEffect } from "react";

export function useSSE(onUpdate: () => void) {
  useEffect(() => {
    let eventSource: EventSource | null = null;
    let timer: NodeJS.Timeout | null = null;

    const connect = () => {
      eventSource = new EventSource("/api/events");

      eventSource.onmessage = (event) => {
        if (event.data === "update") {
          onUpdate();
        }
      };

      eventSource.onerror = (error) => {
        console.error("SSE connection failed:", error);
        if (eventSource) {
          eventSource.close();
        }
        timer = setTimeout(connect, 5000);
      };
    };

    connect();

    return () => {
      if (eventSource) {
        eventSource.close();
      }
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [onUpdate]);
}
