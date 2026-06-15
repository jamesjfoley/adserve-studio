# ============================================================
# Stage 1: Install dependencies
# ============================================================
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json ./apps/web/
COPY packages/database/package.json ./packages/database/
COPY packages/module-framework/package.json ./packages/module-framework/
COPY packages/ai-service/package.json ./packages/ai-service/
COPY packages/crm/package.json ./packages/crm/

RUN pnpm install --frozen-lockfile

# ============================================================
# Stage 2: Build the application
# ============================================================
FROM node:20-alpine AS builder
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app

# NEXT_PUBLIC_* env vars must be present at build time — Next.js inlines them
# into the client bundle. Runtime injection (via ECS task secrets) is too late.
# Pass with: docker build --build-arg NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=...
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY

# Marks the build as the colleague-facing prototype preview (Stage 2). Renders
# the "PROTOTYPE — not production" banner. Unset/false for all prod builds.
ARG NEXT_PUBLIC_PROTOTYPE
ENV NEXT_PUBLIC_PROTOTYPE=$NEXT_PUBLIC_PROTOTYPE

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /app/packages/database/node_modules ./packages/database/node_modules
COPY --from=deps /app/packages/module-framework/node_modules ./packages/module-framework/node_modules
COPY --from=deps /app/packages/ai-service/node_modules ./packages/ai-service/node_modules
COPY --from=deps /app/packages/crm/node_modules ./packages/crm/node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# ============================================================
# Stage 3: Production image
# ============================================================
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/apps/web/public ./apps/web/public
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "apps/web/server.js"]
