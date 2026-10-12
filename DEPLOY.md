# Deploy for free (no backend needed)

eStamp Merger is a **static website**: all merging happens in the user's browser, and PDFs are never uploaded anywhere.
So you only need static hosting - **Netlify alone is enough** (Render is not needed).

## Option A - Drag & drop (about 2 minutes, no Git)

1. On your computer: `npm install` then `npm run build`. This creates a `dist/` folder.
2. Sign in at https://app.netlify.com (free) and open **Add new site -> Deploy manually** (or https://app.netlify.com/drop).
3. Drag the **`dist`** folder onto the page. You get a link like `https://random-name.netlify.app`.
4. (Optional) Site configuration -> Change site name, to get e.g. `estamp-merger.netlify.app`.

To update later: run `npm run build` again and drag the new `dist` folder onto Site -> Deploys.

## Option B - GitHub + Netlify (auto-deploys on every change; recommended)

1. Create a GitHub repository and push this project (`node_modules` and `dist` are already in `.gitignore`).
2. Netlify -> **Add new site -> Import an existing project -> GitHub** -> pick the repository.
3. Settings are read from `netlify.toml` (build command `npm run build`, publish directory `dist`). Click **Deploy**.
4. Every `git push` now redeploys automatically.

## Other free hosts (same idea)

- **Cloudflare Pages**, **Vercel**, **GitHub Pages**: build command `npm run build`, output directory `dist`
  (GitHub Pages also needs `base: "/<repo-name>/"` in `vite.config.js`).
- **Render -> Static Site** also works with the same two settings, but gives no advantage here.

## Good to know

- Only the app files (about 1 MB when compressed) are served by the host. Your PDFs and JSON stay on the user's computer.
- Free-plan limits change over time (Netlify's newer accounts use a monthly credit allowance); check your dashboard.
- If this is used for company work, confirm that hosting the tool on a third-party site is acceptable to your organisation.
