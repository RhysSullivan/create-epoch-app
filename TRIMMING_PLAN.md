# Create-Epoch-App Trimming Plan

This document provides step-by-step instructions to trim this repository into an opinionated minimal stack for creating Effect + Convex apps.

## Overview

**Goal:** An opinionated starter with Effect, Convex, Next.js, and Discord bot foundations - without any AnswerOverflow-specific business logic.

**Stack demonstrates:**
- Effect-first architecture throughout
- Convex + Effect integration via `confect`
- OpenTelemetry observability setup
- Discord bot with Reacord (React for Discord)
- Next.js with Effect runtime
- Type-safe API clients generated from OpenAPI

---

## Phase 1: Remove Packages

### DELETE these packages entirely:

```bash
rm -rf packages/ai
rm -rf packages/github-api
rm -rf packages/database-utils
rm -rf packages/test-utils
```

### DELETE docs app:

```bash
rm -rf apps/docs
```

---

## Phase 2: Create Utils Package

Create a new `packages/utils` package with merged content:

### 2.1 Create package structure

```bash
mkdir -p packages/utils/src
```

### 2.2 Create `packages/utils/package.json`

```json
{
  "name": "@packages/utils",
  "version": "1.0.0",
  "type": "module",
  "exports": {
    "./snowflakes": "./src/snowflakes.ts",
    "./snowflakes-test": "./src/snowflakes-test.ts",
    "./*": "./src/*.ts"
  },
  "dependencies": {
    "effect": "catalog:"
  },
  "devDependencies": {
    "typescript": "catalog:"
  }
}
```

### 2.3 Copy snowflake files (before deleting database-utils)

```bash
cp packages/database-utils/src/snowflakes.ts packages/utils/src/
cp packages/database-utils/src/snowflakes-test.ts packages/utils/src/
```

### 2.4 Update import in snowflakes-test.ts

Change:
```typescript
import { DISCORD_EPOCH, generateSnowflake } from "./snowflakes";
```
(Should already be correct as relative import)

---

## Phase 3: Strip Discord Bot App

### 3.1 DELETE application-specific directories:

```bash
# Delete all commands
rm -rf apps/discord-bot/src/commands

# Delete all interactions  
rm -rf apps/discord-bot/src/interactions

# Delete all services
rm -rf apps/discord-bot/src/services

# Delete all sync logic
rm -rf apps/discord-bot/src/sync

# Delete constants
rm -rf apps/discord-bot/src/constants

# Delete utils (app-specific)
rm -rf apps/discord-bot/src/utils
```

### 3.2 KEEP these files in `apps/discord-bot/src/core/`:

- `discord-service.ts` - Core Discord Effect service
- `discord-client-service.ts` - Discord.js client wrapper
- `discord-client-test-layer.ts` - Test layer
- `discord-client-mock.ts` - Mock implementation
- `discord-mock-arbitraries.ts` - Test arbitraries
- `reacord-layer.ts` - Reacord integration
- `atom-runtime.ts` - Effect-atom runtime
- `runtime.ts` - Main runtime setup
- `layers.ts` - Test layers

### 3.3 KEEP `apps/discord-bot/src/metrics.ts`

### 3.4 Replace `apps/discord-bot/src/bot.ts` with minimal version:

```typescript
import { Console, Effect, Layer } from "effect";
import { Discord } from "./core/discord-service";

// Empty layers - add your command/interaction handlers here
export const BotLayers = Layer.empty;

export const program = Effect.gen(function* () {
  const discord = yield* Discord;

  yield* discord.client.login();

  const guilds = yield* discord.getGuilds();
  yield* Console.log(`Bot is in ${guilds.length} guilds`);

  return yield* Effect.never;
});
```

### 3.5 Update `apps/discord-bot/src/core/runtime.ts`

Remove imports for deleted layers. Update `createAppLayer` to not reference `BotLayers` from bot.ts or simplify:

```typescript
import { PostHogCaptureClientLayer } from "@packages/database/analytics/server";
import { type Database, DatabaseHttpLayer } from "@packages/database/database";
import type { Storage } from "@packages/database/storage";
import { type Effect, Layer, ManagedRuntime } from "effect";
import { PlatformLayer, sharedMemoMap } from "./atom-runtime";
import { DiscordClientLayer } from "./discord-client-service";
import { DiscordLayerInternal } from "./discord-service";
import { ReacordLayer } from "./reacord-layer";

export { atomRuntime } from "./atom-runtime";

export const createAppLayer = (
  storageLayer: Layer.Layer<Storage, never, Database>,
) => {
  const StorageWithDatabase = storageLayer.pipe(
    Layer.provide(DatabaseHttpLayer),
  );

  const DiscordLayers = Layer.mergeAll(
    DiscordClientLayer,
    DiscordLayerInternal,
    ReacordLayer,
  ).pipe(Layer.provide(DiscordClientLayer));

  return Layer.mergeAll(
    PlatformLayer,
    DiscordLayers,
    StorageWithDatabase,
    PostHogCaptureClientLayer,
  );
};

export const runMain = <A, E, R, EL>(
  effect: Effect.Effect<A, E, R>,
  appLayer: Layer.Layer<R, EL, never>,
) => {
  const runtime = ManagedRuntime.make(appLayer, sharedMemoMap);

  const controller = new AbortController();

  const shutdown = async () => {
    console.log("Shutting down gracefully...");
    try {
      await runtime.dispose();
      console.log("Runtime disposed successfully");
    } catch (error) {
      console.error("Error during runtime disposal:", error);
    }
    process.exit(0);
  };

  process.on("SIGINT", () => {
    controller.abort();
    shutdown();
  });
  process.on("SIGTERM", () => {
    controller.abort();
    shutdown();
  });

  return runtime
    .runPromise(effect, { signal: controller.signal })
    .catch((error) => {
      console.error("Fatal error:", error);
      process.exit(1);
    });
};
```

### 3.6 Update `apps/discord-bot/src/core/layers.ts`

Simplify to just test infrastructure:

```typescript
import { DatabaseTestLayer } from "@packages/database/database-test";
import { ConvexStorageLayer } from "@packages/database/storage";
import { Layer } from "effect";
import { DiscordClientTestLayer } from "./discord-client-test-layer";

export const TestLayer = Layer.mergeAll(
  DiscordClientTestLayer,
  DatabaseTestLayer,
  ConvexStorageLayer.pipe(Layer.provide(DatabaseTestLayer)),
);
```

---

## Phase 4: Strip Main Site App

### 4.1 DELETE application-specific routes and components:

```bash
# Delete domain-based multi-tenant routes
rm -rf apps/main-site/src/app/\[domain\]

# Delete AnswerOverflow-specific routes
rm -rf apps/main-site/src/app/\(main-site\)/dashboard
rm -rf apps/main-site/src/app/\(main-site\)/blog
rm -rf apps/main-site/src/app/\(main-site\)/browse
rm -rf apps/main-site/src/app/\(main-site\)/chat
rm -rf apps/main-site/src/app/\(main-site\)/about
rm -rf apps/main-site/src/app/\(main-site\)/c
rm -rf apps/main-site/src/app/\(main-site\)/m
rm -rf apps/main-site/src/app/\(main-site\)/u
rm -rf apps/main-site/src/app/\(main-site\)/og
rm -rf apps/main-site/src/app/\(main-site\)/search
rm -rf apps/main-site/src/app/\(main-site\)/mcp

# Delete app-specific lib files
rm apps/main-site/src/lib/tenant.ts
rm apps/main-site/src/lib/message-markdown.ts
rm apps/main-site/src/lib/github.ts
rm -rf apps/main-site/src/lib/mcp

# Delete app-specific components
rm -rf apps/main-site/src/components
```

### 4.2 KEEP these files:

- `src/instrumentation.ts` - Sentry setup
- `src/instrumentation-client.ts` - Client instrumentation
- `src/proxy.ts` - Next.js proxy (middleware)
- `src/lib/runtime.ts` - Effect runtime
- `src/lib/auth-client.ts` - Auth client
- `src/lib/server-auth.ts` - Server auth
- `src/lib/use-authenticated-query.ts` - Auth hook
- `src/lib/date-utils.ts` - Date utilities
- `src/app/layout.tsx` - Root layout
- `src/app/global-error.tsx` - Error boundary

### 4.3 Simplify API routes

Keep `apps/main-site/src/app/(main-site)/api/[[...slugs]]/route.ts` but simplify handlers:

Delete:
- `src/app/(main-site)/api/handlers/convex-webhooks.ts`
- `src/app/(main-site)/api/handlers/github-webhooks.ts`
- `src/app/(main-site)/api/handlers/messages.ts`

Keep:
- `src/app/(main-site)/api/handlers/auth.ts`

### 4.4 Create minimal home page

Replace `apps/main-site/src/app/(main-site)/page.tsx`:

```tsx
export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <h1 className="text-4xl font-bold">Create Epoch App</h1>
      <p className="mt-4 text-lg text-muted-foreground">
        Effect + Convex + Next.js
      </p>
    </main>
  );
}
```

### 4.5 Simplify `apps/main-site/src/app/(main-site)/layout.tsx`

Remove AnswerOverflow-specific providers and components.

### 4.6 Simplify `apps/main-site/src/app/(main-site)/client.tsx`

Remove app-specific client components.

---

## Phase 5: Strip Database Package

### 5.1 Replace `packages/database/convex/schema.ts` with minimal schema:

```typescript
import {
  compileSchema,
  defineSchema,
  defineTable,
} from "@packages/confect/server";
import { Schema } from "effect";

// Example schema showing patterns - replace with your own
const UserSchema = Schema.Struct({
  name: Schema.String,
  email: Schema.String,
});

const PostSchema = Schema.Struct({
  title: Schema.String,
  content: Schema.String,
  authorId: Schema.String,
  published: Schema.Boolean,
});

export const confectSchema = defineSchema({
  users: defineTable(UserSchema)
    .index("by_email", ["email"]),
  posts: defineTable(PostSchema)
    .index("by_authorId", ["authorId"])
    .index("by_published", ["published"]),
});

export default confectSchema.convexSchemaDefinition;

export { UserSchema, PostSchema };

export const userSchema = compileSchema(UserSchema);
export const postSchema = compileSchema(PostSchema);

export type User = Schema.Schema.Type<typeof UserSchema>;
export type Post = Schema.Schema.Type<typeof PostSchema>;
```

### 5.2 DELETE application-specific Convex files:

```bash
# Delete all app-specific directories
rm -rf packages/database/convex/chat
rm -rf packages/database/convex/stripe
rm -rf packages/database/convex/public
rm -rf packages/database/convex/private
rm -rf packages/database/convex/authenticated
rm -rf packages/database/convex/admin
rm -rf packages/database/convex/api
rm -rf packages/database/convex/migrations
rm -rf packages/database/convex/internal

# Delete app-specific shared files
rm packages/database/convex/shared/github.ts
rm packages/database/convex/shared/threads.ts
rm packages/database/convex/shared/permissions.ts
rm packages/database/convex/shared/permissionsShared.ts
rm packages/database/convex/shared/guildManagerPermissions.ts
rm packages/database/convex/shared/attachments.ts
rm packages/database/convex/shared/anonymization.ts
rm packages/database/convex/shared/messagePrivacy.ts
rm packages/database/convex/shared/channels.ts
rm packages/database/convex/shared/mentions.ts
rm packages/database/convex/shared/messages.ts
rm packages/database/convex/shared/servers.ts
rm packages/database/convex/shared/users.ts
rm packages/database/convex/shared/similarThreads.ts
rm packages/database/convex/shared/threadSummaryAgent.ts
rm packages/database/convex/shared/stripe.ts
rm packages/database/convex/shared/ai.ts
rm packages/database/convex/shared/publicSchemas.ts
rm packages/database/convex/shared/auth/github.ts

# Delete triggers
rm packages/database/convex/triggers.ts
```

### 5.3 KEEP these database files:

- `convex/confect.ts` - Confect setup
- `convex/http.ts` - HTTP router (simplify)
- `convex/schema.ts` - Minimal schema (replace content)
- `convex/convex.config.ts` - Convex config
- `convex/auth.config.ts` - Auth config
- `convex/betterAuth/` - Keep entire directory (auth setup)
- `convex/shared/index.ts` - Keep (simplify)
- `convex/shared/auth.ts` - Keep
- `convex/shared/betterAuth.ts` - Keep
- `convex/shared/authIdentity.ts` - Keep
- `convex/shared/shared.ts` - Keep
- `convex/shared/validators.ts` - Keep
- `convex/shared/dataAccess.ts` - Keep
- `convex/shared/models.ts` - Keep
- `convex/shared/rateLimiter.ts` - Keep
- `convex/shared/auth/betterAuthService.ts` - Keep
- `convex/client/` - Keep entire directory
- `convex/_generated/` - Keep (auto-generated)

### 5.4 Simplify `packages/database/convex/http.ts`

Remove AnswerOverflow-specific HTTP routes, keep just auth routes.

### 5.5 Simplify `packages/database/convex/shared/index.ts`

Remove exports for deleted files.

---

## Phase 6: Strip UI Package

### 6.1 DELETE application-specific components:

```bash
# Delete AnswerOverflow-specific components
rm -rf packages/ui/src/components/discord-message
rm -rf packages/ui/src/components/navbar
rm -rf packages/ui/src/components/admin
rm packages/ui/src/components/server-icon.tsx
rm packages/ui/src/components/server-invite.tsx
rm packages/ui/src/components/messages-search-bar.tsx
rm packages/ui/src/components/tenant-context.tsx
rm packages/ui/src/components/custom-domain.tsx
rm packages/ui/src/components/message-blurrer.tsx
rm packages/ui/src/components/jump-to-solution.tsx
rm packages/ui/src/components/answer-overflow-icon.tsx
rm packages/ui/src/components/answer-overflow-logo.tsx
rm packages/ui/src/components/bot-permissions.tsx
rm packages/ui/src/components/channel-bot-permissions-status.tsx
rm packages/ui/src/components/bot-customization.tsx
rm packages/ui/src/components/dns-table.tsx
rm packages/ui/src/components/impersonation-banner.tsx
rm packages/ui/src/components/message-body.tsx
rm packages/ui/src/components/discord-message.tsx
rm packages/ui/src/components/message-timestamp.tsx
rm packages/ui/src/components/track-link-button.tsx
rm packages/ui/src/components/track-load.tsx
rm packages/ui/src/components/sign-in-if-anon.tsx

# Delete app-specific analytics
rm packages/ui/src/analytics/cumulative.tsx
rm packages/ui/src/analytics/timeseries.tsx
```

### 6.2 KEEP these UI components (core shadcn/ui + utilities):

**Core shadcn/ui:**
- accordion, alert, alert-dialog, aspect-ratio, avatar, button
- calendar, card, checkbox, collapsible, command, context-menu
- dialog, dropdown-menu, form, hover-card, input, input-group
- label, link, navigation-menu, pagination, popover, progress
- radio-group, scroll-area, select, separator, sidebar, skeleton
- slider, spinner, switch, tabs, textarea, toggle, toggle-group, tooltip

**Utility components:**
- `convex-client-provider.tsx`
- `convex-infinite-list.tsx`
- `providers.tsx`
- `theme-switcher.tsx`
- `relative-time.tsx`
- `time-ago.tsx`
- `error-page.tsx`
- `empty.tsx`
- `code.tsx`
- `callouts.tsx`
- `field.tsx`
- `item.tsx`
- `date-range-picker.tsx`
- `formatted-number.tsx`
- `hydration-context.tsx`
- `image-lightbox.tsx`
- `link-button.tsx`
- `button-group.tsx`
- `search-input.tsx`

**Analytics client:**
- Keep `src/analytics/client/` directory
- Keep `src/analytics/index.ts`
- Keep `src/analytics/chart.tsx`

### 6.3 Update `packages/ui/package.json` exports

Remove exports for deleted components.

---

## Phase 7: Update Package References

### 7.1 Update imports throughout codebase

Search and replace:
- `@packages/database-utils` -> `@packages/utils`
- `@packages/test-utils` -> `@packages/utils`

### 7.2 Update workspace dependencies

In any `package.json` that references deleted packages:
- Remove `@packages/ai`
- Remove `@packages/github-api`
- Change `@packages/database-utils` to `@packages/utils`
- Change `@packages/test-utils` to `@packages/utils`

---

## Phase 8: Clean Up

### 8.1 Update root `package.json` workspace definitions

Ensure deleted packages are removed from workspaces.

### 8.2 Run linting and type checking

```bash
bun install
bun run typecheck
```

### 8.3 Fix any broken imports/references

### 8.4 Update `.cursor/rules/` 

Remove references to deleted packages in rule files.

### 8.5 Clean up `.context/` submodules if needed

Consider which context repos are still relevant.

---

## Phase 9: Regenerate Convex

After schema changes:

```bash
cd packages/database
bunx convex dev --once
```

---

## Final Structure

```
apps/
  discord-bot/
    src/
      core/           # Discord service, layers, runtime
      bot.ts          # Empty bot template
      metrics.ts      # OTEL metrics
  main-site/
    src/
      app/
        (main-site)/
          api/        # Auth API routes
          page.tsx    # Minimal home
          layout.tsx  # Minimal layout
        layout.tsx
        global-error.tsx
      lib/
        runtime.ts    # Effect runtime
        auth-client.ts
        server-auth.ts
        use-authenticated-query.ts
        date-utils.ts
      instrumentation.ts
      instrumentation-client.ts
      proxy.ts

packages/
  agent/              # Agent framework (unchanged)
  confect/            # Effect + Convex integration (unchanged)
  convex-test/        # Convex testing (unchanged)
  database/
    convex/
      betterAuth/     # Auth setup
      client/         # Convex clients
      shared/         # Shared utilities (minimal)
      _generated/
      confect.ts
      http.ts
      schema.ts       # Minimal example schema
      convex.config.ts
      auth.config.ts
  discord-api/        # Generated Discord API client (unchanged)
  observability/      # OTEL + Axiom (unchanged)
  reacord/            # React for Discord (unchanged)
  typescript-config/  # Shared configs (unchanged)
  ui/                 # Core UI components only
  utils/              # Snowflakes + general utilities (NEW)
```

---

## Verification Checklist

- [ ] All deleted packages removed
- [ ] `packages/utils` created with snowflake utilities
- [ ] Discord bot starts with empty layers
- [ ] Main site builds and shows minimal page
- [ ] Database schema is minimal example
- [ ] UI package has only core components
- [ ] All imports resolve correctly
- [ ] TypeScript compiles without errors
- [ ] Convex generates successfully
