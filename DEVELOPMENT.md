# Home-Lists: Development & Operations Manual

## 1. Project Overview
A real-time, AI-powered shared task and shopping list application. It is designed to run in a secure Tailnet without authentication, using a local LLM for automatic categorization.

## 2. Technical Stack
- **Frontend/Backend:** Next.js (App Router, Server Actions)
- **Database:** PostgreSQL via Prisma ORM
- **Real-Time:** Server-Sent Events (SSE)
- **AI:** Ollama (Gemma 4/2)
- **Deployment:** Docker Compose (with Host Network Mode for app)

## 3. How to Run as a Permanent Service
The application uses **Host Network Mode** for the `app` container to ensure reliable communication with the host's local Ollama service and for stable SSE (Server-Sent Events) performance.

### Commands:
- **Start Service (Background):**
  ```bash
  docker compose up -d --build
  ```
- **Stop Service:**
  ```bash
  docker compose down
  ```
- **Check Status:**
  ```bash
  docker compose ps
  ```
- **View Logs (Live):**
  ```bash
  docker compose logs -f app
  ```

## 4. Architecture & Implementation Details

### Real-Time Sync (SSE)
We use a global `EventEmitter` on the server. Whenever a database mutation occurs (via Server Actions), `broadcastUpdate()` is called. This triggers an event sent through a long-lived dynamic HTTP connection (`/api/events`) to all connected clients.
- **Client Sync:** A custom React hook `useSSE` listens for these events and refreshes the data automatically.

### AI Categorization
Located in `src/lib/ai.ts`. It fetches the current category tree from the database and sends it as context to Ollama.
- **Model:** `gemma4:latest` (Uses the local model on the Ubuntu host).
- **Network:** Connected via `127.0.0.1` because of Host Network Mode.
- **Prompt:** Enforces a JSON response containing `type` (TASK/SHOPPING), `categoryPath`, and `itemName`.

### Database Schema
- **Category:** Supports recursive parent/child relationships for infinite nesting.
- **Item:** Linked to a category (nullable) and a type (Enum).

### iOS Shortcut Support
The endpoint `/api/add` accepts a JSON POST request:
```json
{ "text": "לקנות חלב" }
```
It routes the text through the same AI logic as the web UI.

## 5. Environment Variables (`.env`)
- `DATABASE_URL`: Set to `postgresql://yossef:home-lists-secret@127.0.0.1:5432/home_lists?schema=public` (connects to the DB container mapped to host port 5432).
- `OLLAMA_URL`: Set to `http://127.0.0.1:11434` (connects to Ollama on the Ubuntu host).
- `NEXT_PUBLIC_APP_URL`: The URL where the app is hosted (e.g., `http://localhost:3000`).

## 6. Manual Controls
The UI provides:
- Checkbox to toggle completion (items drop to bottom).
- "Clear Checked Items" button to delete finished items.
- Manual delete buttons (on hover).
- RTL Hebrew support by default.
