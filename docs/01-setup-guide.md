# AdServe Studio — Setup guide

## Prerequisites

### 1. Install Docker Desktop (macOS)

Download from [docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop/) and install. After installation, open Docker Desktop and let it finish starting up (you'll see the whale icon in your menu bar turn solid).

Verify it's working:
```bash
docker --version
docker compose version
```

### 2. Install Node.js 20+

If you don't have it, the easiest way on macOS:
```bash
brew install node@20
```

Or download from [nodejs.org](https://nodejs.org/).

### 3. Install pnpm

```bash
npm install -g pnpm
```

### 4. Create a Clerk account

1. Go to [clerk.com](https://clerk.com/) and sign up
2. Create a new application — name it "AdServe Studio"
3. Under "Configure > Organizations", **enable Organizations** — this is critical, it maps to our multi-tenancy model
4. Under "Configure > Sessions", ensure JWT claims include organization info
5. Copy your API keys from the dashboard:
   - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
   - `CLERK_SECRET_KEY`

### 5. Clone and set up

```bash
# Clone the repo
git clone git@github.com:jamesjfoley/adserve-studio.git
cd adserve-studio

# Install dependencies
pnpm install

# Copy environment template
cp .env.example .env.local

# Edit .env.local and add your Clerk keys + any other config
```

### 6. Start the database

```bash
docker compose up -d
```

This starts PostgreSQL 16 and Redis 7 locally. Postgres runs on port 5432, Redis on 6379.

### 7. Run database migrations

```bash
pnpm db:generate   # Generate migration files from Drizzle schema
pnpm db:migrate    # Apply migrations to local database
pnpm db:seed       # Seed modules and permissions
```

### 8. Start the dev server

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Project structure

```
adserve-studio/
├── apps/web/                   # Next.js application
│   └── src/
│       ├── app/                # App router pages and API routes
│       │   ├── (auth)/         # Sign-in, sign-up pages
│       │   ├── (platform)/     # Authenticated pages
│       │   └── api/            # REST API route handlers
│       ├── components/         # Shared UI components
│       ├── lib/                # Utilities, auth, AI, tenant helpers
│       └── middleware.ts       # Auth + tenant resolution middleware
├── packages/database/          # Database schema and migrations
│   └── src/
│       ├── schema/             # Drizzle table definitions
│       ├── seed/               # Seed scripts
│       └── client.ts           # Tenant-aware DB client
├── docker-compose.yml          # Local Postgres + Redis
├── .env.example                # Environment variable template
└── docs/                       # Architecture documentation
```

## Useful commands

| Command | What it does |
|---------|-------------|
| `pnpm dev` | Start Next.js dev server |
| `pnpm build` | Production build |
| `pnpm db:generate` | Generate Drizzle migrations from schema changes |
| `pnpm db:migrate` | Apply pending migrations |
| `pnpm db:seed` | Run seed scripts |
| `pnpm db:studio` | Open Drizzle Studio (visual DB browser) |
| `docker compose up -d` | Start Postgres + Redis |
| `docker compose down` | Stop Postgres + Redis |
| `docker compose down -v` | Stop and delete all data (fresh start) |
