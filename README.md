# Project Documentation: AI-Powered Shared Task & Shopping List
## 1. Project Overview
A real-time, self-hosted web application designed to manage shared tasks and a deeply categorized shopping list. The application operates exclusively within a secure Tailnet, bypassing the need for user authentication. It leverages a local Large Language Model (LLM) to automatically classify, categorize, and organize user inputs, while providing a snappy, real-time UI that instantly syncs changes across all connected iOS devices.
## 2. User Interface & Experience (UI/UX)
 * **Tabbed Interface:** The application launches with a clean layout containing exactly two tabs, both starting completely empty:
   * **משימות** (Tasks)
   * **רשימת קניות** (Shopping List)
 * **Real-Time Synchronization:** Strict online-only syncing. Any addition, state change (checking an item), or deletion on one device is instantly broadcasted to the other via Server-Sent Events (SSE) or WebSockets.
 * **Item Display & Lifecycle (Applies to both tabs):**
   * Every item features a checkbox.
   * **Active State:** Unchecked items remain at the top of their respective lists or categories.
   * **Checked State:** Once checked, items automatically drop to the bottom of the view.
   * **Clear Action:** A dedicated "נקה פריטים שסומנו" (Clear Checked Items) button visually separates active items from checked items. Pressing this permanently deletes all checked items from the database.
## 3. Categorization & Hierarchy
 * **Tasks (משימות):** A flat list structure. No categories, times, or reminders.
 * **Shopping List (רשימת קניות):** Supports a deeply nested structure to organize items efficiently.
   * **Infinite Nesting Capability:** Items can belong to top-level categories (e.g., סופרמרקט) and nested sub-categories (e.g., פירות וירקות).
   * **Empty State:** Categories do not exist by default; they are generated dynamically by the AI or manually by the user.
## 4. Input & AI Auto-Categorization (Gemma 4)
The default behavior for adding any new item prioritizes automation via the local LLM.
 * **Text Input:** The user types a raw string (e.g., "לקנות חלב" or "להחליף נורה") into a global input field.
 * **Voice Input (iOS Shortcut):** * A custom Apple Shortcut is triggered by voice (e.g., "היי סירי, תוסיפי...").
   * Siri dictates the Hebrew phrase and sends the raw text payload via a POST request directly to the application's API.
 * **LLM Processing (Gemma 4):**
   * The raw text (from UI or Shortcut) is routed to the local Ollama instance running Gemma 4 on the Ubuntu host.
   * Gemma 4 analyzes the text against the current database schema and returns a structured JSON payload determining:
     1. **Destination Tab:** Is this a Task or a Shopping Item?
     2. **Location:** If a Shopping Item, which existing category and sub-category does it belong to?
     3. **Dynamic Creation:** If the item does not fit into any existing category, the AI dictates the creation of a logical new category/sub-category on the fly.
 * **Execution:** The application parses the AI's JSON, commits the data (and any new categories) to the database, and pushes the real-time UI update to all clients.
## 5. Manual Controls & Overrides
While the AI handles the default input routing, the UI provides full manual control over the entire data structure:
 * **Manual Entry:** Ability to bypass the AI and add an item directly into a specific category or tab.
 * **Category Management:** UI tools to manually create, rename, and delete categories and nested sub-categories.
 * **Drag-and-Drop / Moving:** Ability to manually move items between categories or reassign a shopping item to the tasks list (and vice versa).
## 6. Technical Architecture & Stack
 * **Frontend:** Next.js utilizing React Server Components and Client Components for the interactive UI.
 * **Backend:** Next.js API Routes to handle database transactions, LLM routing, and the iOS Shortcut webhooks.
 * **Real-Time Engine:** WebSockets (via Socket.io) or Server-Sent Events (SSE) handling the instant UI updates.
 * **Database Layer:** * **PostgreSQL:** Relational database ideal for handling the recursive/nested category logic of the shopping list.
   * **Prisma ORM:** Managing the schema, migrations, and type-safe database queries.
 * **AI Engine:** Gemma 4 running locally via Ollama (localhost:11434), accessible to the Next.js backend.
 * **Deployment & Networking:** * **Docker Compose:** Containerizing the Next.js web app and the PostgreSQL database into a single cohesive deployment.
   * **Host:** Always-on Ubuntu machine.
   * **Access:** Exclusively routed through the Tailnet (Tailscale). No external internet exposure, no password authentication required.
## 7. Data Schema Blueprint (Conceptual)
To support the required logic, the database requires two primary models:
 * **Item:**
   * id, name (String), isChecked (Boolean), type (Enum: TASK | SHOPPING), categoryId (Nullable Foreign Key).
 * **Category:**
   * id, name (String), parentId (Nullable Foreign Key referencing another Category to allow infinite nesting).
