# CostClock

Free process cost calculator by [Workthru](https://www.workthru.co.uk).

Map any business process step by step, assign real team rates, and see the true fully-loaded cost — with automation savings.

## Quick Start

```bash
npm install
npm run dev
```

## Deploy to Vercel

1. Create a new repo on GitHub and push this project
2. Connect to Vercel → Import Project
3. Set custom domain: `costclock.workthru.co.uk`
4. Deploy

The app works immediately without Supabase — all features except Save/Register.

## Enable Supabase (Auth + Persistence)

1. Create a project at [supabase.com](https://supabase.com)
2. Run the schema from `COSTCLOCK-ARCHITECTURE.md` in SQL Editor
3. Enable Email auth in Authentication → Providers
4. Add environment variables in Vercel:

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

5. Redeploy

## Project Structure

```
costclock/
├── index.html          — HTML entry point with Google Fonts
├── src/
│   ├── main.jsx        — React mount
│   ├── App.jsx         — Full CostClock app (all screens)
│   └── supabase.js     — Supabase client + auth/CRUD helpers
├── package.json
├── vite.config.js
├── vercel.json         — SPA routing + security headers
├── .env.example        — Environment variable template
└── .gitignore
```

## Stack

- React 18 + Vite
- Supabase (auth + PostgreSQL)
- Vercel (hosting)
- Fraunces + DM Sans (typography)
