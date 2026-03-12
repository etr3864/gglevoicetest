# =============================================================================
# Stage 1 – deps
# Install all dependencies. Cached as long as package.json/lockfile unchanged.
# =============================================================================
FROM node:22-alpine AS deps

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy only manifests – no source code so cache isn't broken by code changes
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/db/package.json      ./packages/db/package.json
COPY packages/shared/package.json  ./packages/shared/package.json
COPY apps/api/package.json         ./apps/api/package.json

RUN pnpm install --frozen-lockfile


# =============================================================================
# Stage 2 – builder
# Compile all packages in dependency order.
# =============================================================================
FROM node:22-alpine AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Bring installed node_modules from deps stage
COPY --from=deps /app/node_modules                  ./node_modules
COPY --from=deps /app/apps/api/node_modules         ./apps/api/node_modules
COPY --from=deps /app/packages/shared/node_modules  ./packages/shared/node_modules
COPY --from=deps /app/packages/db/node_modules      ./packages/db/node_modules

# Copy source
COPY tsconfig.base.json                   ./
COPY packages/shared                      ./packages/shared
COPY packages/db                          ./packages/db
COPY apps/api                             ./apps/api

# Build: shared → db (prisma generate + tsc) → api
RUN pnpm --filter @voice/shared build
RUN pnpm --filter @voice/db     build
RUN pnpm --filter @voice/api    build


# =============================================================================
# Stage 3 – runner
# Minimal production image: only compiled JS, prod dependencies, prisma client.
# =============================================================================
FROM node:22-alpine AS runner

RUN corepack enable && corepack prepare pnpm@latest --activate

# Non-root user for Kubernetes security policy
RUN addgroup -S nodejs && adduser -S nodejs -G nodejs

WORKDIR /app

# --- package manifests (needed for pnpm install --prod) ---
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/db/package.json      ./packages/db/package.json
COPY packages/shared/package.json  ./packages/shared/package.json
COPY apps/api/package.json         ./apps/api/package.json

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# --- compiled output ---
COPY --from=builder /app/packages/shared/dist  ./packages/shared/dist
COPY --from=builder /app/packages/db/dist      ./packages/db/dist
COPY --from=builder /app/apps/api/dist         ./apps/api/dist

# --- prisma: copy schema + migrations, generate client ---
COPY packages/db/prisma ./packages/db/prisma
RUN pnpm dlx prisma@6 generate --schema=packages/db/prisma/schema.prisma

RUN chown -R nodejs:nodejs /app
USER nodejs

WORKDIR /app/apps/api

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "dist/index.js"]
