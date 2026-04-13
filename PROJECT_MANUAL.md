# Home-Lists: Full Project Manual & Developer Guide

## 1. Project Overview & Goals
**Home-Lists** is a real-time, self-hosted web application designed for managing shared tasks and a deeply categorized shopping list. It is specifically built to run within a secure private network (Tailscale/Local) and operates without authentication.

The primary goal is **Zero-Effort Entry**: A user can type (or dictate via Siri) raw natural language, and a local AI (Ollama) handles the cognitive load of splitting, rephrasing, and filing items into a strict, store-oriented hierarchy.

## 2. Technical Architecture

### Core Stack
- **Frontend:** Next.js 15 (App Router), Tailwind CSS 4.
- **Backend:** Next.js Server Actions (stateless logic).
- **Database:** PostgreSQL via Prisma ORM.
- **AI Engine:** Ollama running `qwen2.5:0.5b` on the host machine.
- **Real-Time Sync:** Server-Sent Events (SSE) via a custom `/api/events` stream and a global `EventEmitter`.
- **State Management:** `SWR` for optimistic client-side updates and automatic revalidation.

### Deployment Configuration
The app runs in **Docker Compose**.
- **Host Network Mode:** The `app` container uses `network_mode: host`. This was a critical architectural decision to ensure the container can reach the Ollama service on `127.0.0.1` and to maintain stable SSE performance.
- **Persistence:** Database data is stored in a named Docker volume `postgres_data`.

## 3. How It Works (The "Brain")

### Input Processing Flow
1. User submits text via the UI or `POST /api/add`.
2. A **Placeholder** is created immediately in the DB (`🔄 מעבד: [text]`) for instant visual feedback.
3. The server enqueues the request into a **Sequential AI Queue** (`aiProcessingQueue`). This prevents CPU/RAM spikes on the host.
4. **AI Analysis:** The prompt (in `src/lib/ai.ts`) uses English instructions for high-precision logic but Hebrew data for results. It splits compound sentences into multiple items.
5. **Database Transaction:** Finalized items are created, and the placeholder is deleted in a single atomic transaction.
6. **Live Update:** `broadcastUpdate()` triggers all connected browsers to refresh their lists.

### The Static Hierarchy
Unlike typical apps, the categories are **not** user-editable in the UI. They are defined in `categories.json`. The AI is strictly forbidden from "inventing" categories; it must map items to this existing structure.

## 4. Operational Commands

### Starting / Stopping
```bash
# Start the service (rebuilds if code changed)
docker compose up -d --build

# Stop the service cleanly
docker compose down

# Live Logs (Critical for monitoring AI responses)
docker compose logs -f app
```

### Configuration Changes
If you modify `categories.json`, you should refresh the database:
1. Edit `categories.json`.
2. Use the "Reset from Config" logic (implemented in `src/app/actions.ts`) or manually truncate and restart.

## 5. Debugging & Maintenance

### Common Issues
- **Items stay in "Processing":** Check `docker compose logs -f app`. Usually indicates Ollama is slow or the model is loading. 
- **Character Deletion:** We switched to Qwen 2.5 because Llama 3.1 was inconsistently stripping the Hebrew letter "Lamed". Ensure `src/lib/ai.ts` uses a model with strong Hebrew support.
- **Empty Lists:** Ensure the UI filtering logic in `src/app/page.tsx` is correctly looking for the `🔄` prefix.

### DB Inspection
```bash
docker exec -it home-lists-db-1 psql -U yossef -d home_lists
```

## 6. Current Feature Status

### ✅ Working Perfectly
- **Optimistic UI:** Checkboxes and deletions react instantly.
- **Mobile-First Design:** Scaled for iPhone; all controls are persistent touch-targets (no hover).
- **Dark Mode:** Deep black theme optimized for OLED.
- **Multi-Item Splitting:** "Bread and milk" correctly creates two items.
- **Sequential Queueing:** Multiple people can add items at once without crashing the CPU.

### ⚠️ Needs Polish / Known Quirks
- **AI Latency:** AI categorization can take 30-90 seconds. The UI compensates with pulsing status lines.
- **Strict Matching:** The AI occasionally uses English category names. A normalization mapper in `ai.ts` handles common cases (e.g., "SUPERMARKET" $\rightarrow$ "סופרמרקט"), but new categories in JSON must be added to this mapper if the AI misses them.

## 7. Instructions for the Next Developer
- **Do not remove `network_mode: host`** unless you have a specific plan for container-to-host DNS resolution for Ollama.
- **Keep Server Actions stateless.** Use `globalThis` if you need to persist a queue across requests.
- **Always use `revalidatePath("/")`** and `broadcastUpdate()` together to ensure real-time sync works.
- **UI controls must remain persistent.** Never hide buttons behind hover states, as the primary user is on mobile.
