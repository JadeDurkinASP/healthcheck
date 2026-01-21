# Site Health Dashboard

A lightweight **website health-check dashboard** built with **React + Vite** and a **Node audit server**.

The app allows you to enter a public URL and run automated checks including:

* Performance auditing via Lighthouse
* Core Web Vitals metrics
* Accessibility testing (axe-core)

This project is designed to run **standalone** (not embedded in an iframe).

---

## Tech Stack

**Frontend**

* React
* Vite
* Web Vitals

**Backend / Audit Engine**

* Node.js
* Express
* Lighthouse
* Chrome Launcher
* axe-core

---

## Project Structure

```
/
├─ index.html          # Vite entry HTML
├─ main.jsx            # React bootstrap
├─ App.jsx             # Main UI and logic
├─ server/
│  └─ audit-server.js  # Node server running Lighthouse & audits
├─ package.json
├─ vite.config.js
└─ README.md
```

---

## Requirements

* **Node.js 18+** (Node 20 recommended)
* npm
* Google Chrome (for Lighthouse)

Check your Node version:

```
node -v
```

---

## Getting Started

### 1. Install dependencies

From the project root:

```
npm install
```

---

### 2. Run the frontend (React UI)

```
npm run dev
```

The app will be available at:

```
http://localhost:5173
```

---

### 3. Run the audit server (required for checks)

In a separate terminal:

```
npm run start
```

or

```
node server/audit-server.js
```

This server:

* Launches headless Chrome
* Runs Lighthouse
* Executes accessibility audits
* Returns structured results to the frontend

---

## Typical Local Development Flow

1. Start the audit server
2. Start the Vite dev server
3. Open the app in the browser
4. Enter a URL
5. View performance, vitals, and accessibility results

Both servers must be running for full functionality.

---

## Build for Production

```
npm run build
```

This creates a static build in the configured output directory (used for GitHub Pages deployment).

To preview the production build locally:

```
npm run preview
```

---

## Linting

```
npm run lint
```

---

## Notes & Limitations

* URLs must be publicly accessible (no auth-gated pages)
* Some sites may block automated audi
