# Copilot Instructions for Site Health Dashboard

## Project Overview
- **Frontend:** React (src/), Vite (vite.config.js)
- **Backend:** Node.js audit server (server/audit-server.js) using Lighthouse, Chrome Launcher, and axe-core
- **Purpose:** Run audits (performance, web vitals, accessibility) on public URLs and display results in a dashboard UI

## Key Files & Structure
- `src/App.jsx`: Main UI, tabbed dashboard, data flow from audit hooks
- `src/hooks/useAudit.js`: Handles audit state, runs, and data extraction
- `src/hooks/useRecommendations.js`: Manages AI recommendations (OpenAI integration)
- `server/audit-server.js`: Express server, runs audits, exposes API endpoints
- `vite.config.js`: Vite build/dev config
- `public/`, `docs/`: Static assets and documentation

## Data Flow & Integration
- **Frontend** calls backend audit server for each audit run
- **Audit server** launches headless Chrome, runs Lighthouse/axe-core, returns structured JSON
- **Frontend** parses and displays results in tabs (performance, opportunities, diagnostics, AI, ASP)
- **AI recommendations**: Uses OpenAI API key (user-supplied, not persisted)

## Developer Workflows
- **Install:** `npm install`
- **Dev frontend:** `npm run dev` (Vite, port 5173)
- **Dev backend:** `npm run start` or `node server/audit-server.js` (Node, port 3001 by default)
- **Build:** `npm run build` (static output for deployment)
- **Preview build:** `npm run preview`
- **Lint:** `npm run lint`

## Project Conventions
- **Tabs/sections:** See `TAB_LABELS` in App.jsx for tab keys and labels
- **Audit data shape:** See useAudit.js for expected PSI/DOM audit structure
- **No authentication:** All audits are for public URLs only
- **No persistent storage:** All state is in-memory/client-side
- **OpenAI key:** Only stored in React state, never sent to backend

## Patterns & Tips
- **Component state:** Managed via React hooks, especially for audit and AI flows
- **API endpoints:** See audit-server.js for available routes and expected payloads
- **Error handling:** Errors surfaced in UI via `error` state from hooks
- **Adding new audit types:** Extend audit-server.js and update useAudit.js accordingly

## Examples
- To add a new tab, update `TAB_LABELS` and add a new conditional in App.jsx
- To add a new audit metric, update audit-server.js and the relevant hook/UI

Refer to README.md for more details on setup and usage.