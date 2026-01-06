# create-epoch-app

An opinionated starter template for building full-stack applications with **Effect**, **Convex**, and **Next.js**.

e - effect
p - posthog
o - otel
c - convex
h - help me find something with h to cram in here

## What's Included

### Apps

- **`apps/main-site`** - Next.js 15 app with App Router, Tailwind CSS, and shadcn/ui components
- **`apps/discord-bot`** - Discord bot built with Effect and Reacord (React for Discord)

### Packages

- **`packages/confect`** - Effect + Convex integration layer with type-safe schemas and handlers
- **`packages/database`** - Convex backend with Better Auth integration
- **`packages/ui`** - Shared React components built on Radix UI and Tailwind
- **`packages/reacord`** - React renderer for Discord embeds and interactions
- **`packages/observability`** - Sentry and OpenTelemetry integration for Effect
- **`packages/convex-test`** - Testing utilities for Convex functions

## Tech Stack

- **[Effect](https://effect.website)** - Type-safe functional programming
- **[Convex](https://convex.dev)** - Backend-as-a-service with real-time sync
- **[Next.js 15](https://nextjs.org)** - React framework with App Router
- **[Better Auth](https://better-auth.com)** - Authentication for Convex
- **[Tailwind CSS](https://tailwindcss.com)** - Utility-first CSS
- **[Radix UI](https://radix-ui.com)** - Headless UI primitives
- **[Discord.js](https://discord.js.org)** - Discord API wrapper
- **[Turbo](https://turbo.build)** - Monorepo build system
- **[Biome](https://biomejs.dev)** - Fast linter and formatter

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) >= 1.0
- [Node.js](https://nodejs.org) >= 18
- A [Convex](https://convex.dev) account

### Setup

1. Clone the repository:

```bash
git clone https://github.com/your-username/create-epoch-app.git
cd create-epoch-app
```

2. Install dependencies:

```bash
bun install
```

3. Copy the environment file and configure it:

```bash
cp .env.example .env
```

4. Set up Convex:

```bash
cd packages/database
bunx convex dev
```

5. Start development:

```bash
bun dev
```

This starts:

- Next.js app at http://localhost:3000
- Discord bot (if configured)
- Convex dev server

## Project Structure

```
├── apps/
│   ├── discord-bot/     # Discord bot with Effect + Reacord
│   └── main-site/       # Next.js frontend
├── packages/
│   ├── confect/         # Effect + Convex integration
│   ├── convex-test/     # Convex testing utilities
│   ├── database/        # Convex backend + auth
│   ├── observability/   # Sentry + OpenTelemetry
│   ├── reacord/         # React for Discord
│   └── ui/              # Shared UI components
└── scripts/             # Build and setup scripts
```

## Key Patterns

### Effect + Convex (Confect)

The `confect` package provides type-safe Convex functions with Effect:

```typescript
import { ConfectMutation } from "@packages/confect/server";
import * as Schema from "effect/Schema";

export const createPost = ConfectMutation({
  args: Schema.Struct({ title: Schema.String }),
  handler: (ctx, args) =>
    Effect.gen(function* () {
      const id = yield* ctx.db.insert("posts", { title: args.title });
      return id;
    }),
});
```

### Discord Bot with Reacord

Build Discord UIs with React components:

```tsx
import { Button, Container } from "@packages/reacord";

function WelcomeMessage({ username }: { username: string }) {
  return (
    <Container>
      <h1>Welcome, {username}!</h1>
      <Button label="Get Started" onClick={() => console.log("clicked")} />
    </Container>
  );
}
```

### Better Auth Integration

Authentication is pre-configured with Better Auth for Convex:

```typescript
import { useSession } from "@packages/ui/components/convex-client-provider";

function Profile() {
  const { data: session } = useSession();
  if (!session) return <SignInButton />;
  return <div>Hello, {session.user.name}</div>;
}
```

## Scripts

```bash
bun dev          # Start all apps in development
bun build        # Build all packages
bun typecheck    # Type check all packages
bun test         # Run tests
bun lint         # Lint with Biome
bun lint:fix     # Fix lint issues
```

## License

[FSL-1.1-MIT](LICENSE.md) - Functional Source License with MIT future license.
