# Home-Lists: Development & Operations Manual

## 1. Project Overview
A real-time, AI-powered shared task and shopping list application using a static category hierarchy.

## 2. Technical Stack
- **Frontend/Backend:** Next.js (App Router, Server Actions)
- **Database:** PostgreSQL via Prisma ORM
- **Real-Time:** Server-Sent Events (SSE)
- **AI:** Ollama (Llama 3.1 8B)
- **Deployment:** Docker Compose

## 3. Categories Management
The system uses a fixed hierarchy defined in `categories.json`.

### How to update categories:
1. Edit the `categories.json` file in the project root.
2. If you want to force a clean reload of the categories (Wipe all data and restart fresh from config):
   ```bash
   docker exec -it home-lists-app-1 node -e 'require("./src/app/actions.js").resetDatabaseFromConfig()'
   ```
   *Note: This command is internal. For ease of use, you can also just restart the stack after editing the file, or use the "Reset" logic in the code.*

## 4. How to Run
```bash
docker compose up -d --build
```

## 5. Mobile & Dark Mode
The UI is optimized for iPhone with a persistent control set (no hover needed) and a deep-dark theme for OLED screens.
