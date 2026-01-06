# Effect RPC Benchmark Results

## Executive Summary

| Approach             | Query Overhead  | Mutation Overhead | Recommendation |
| -------------------- | --------------- | ----------------- | -------------- |
| **No Effect**        | baseline (89ms) | baseline (115ms)  | Fastest        |
| **effect/Micro**     | **+5ms (+5%)**  | **+5ms (+4%)**    | **Best balance** |
| **MicroRpcBuilder**  | **+5ms (+6%)**  | **+5ms (+4%)**    | **Best for RPC** |
| Effect (no Schema)   | +21ms (+24%)    | +20ms (+17%)      | -              |
| Effect (with Schema) | +22ms (+25%)    | +18ms (+15%)      | -              |
| Full Effect RPC      | +41ms (+47%)    | +28ms (+23%)      | Full features  |

## Key Finding: Schema is NOT the Problem

We isolated Schema import overhead and found:

| Component            | Query Cost | Mutation Cost |
| -------------------- | ---------- | ------------- |
| Effect core (no Schema) | ~21ms   | ~20ms         |
| Schema import        | **~0-1ms** | **~0-6ms**    |
| Full RPC middleware  | ~20ms      | ~8ms          |

**Schema adds essentially zero overhead.** The cost comes from Effect's core module (fiber system, context machinery, etc.).

## Overhead Breakdown

```
No Effect:           0ms (baseline)
├─ Micro:           +5ms  ← effect/Micro is lean
├─ Effect core:    +20ms  ← Effect, Context, Exit, pipe
├─ Schema:          +0ms  ← Schema adds nothing!
└─ RPC middleware: +20ms  ← ctx.db wrapper, etc.
Total Full RPC:    +40ms
```

## MicroRpcBuilder (Our Solution)

A lightweight RPC factory using `effect/Micro` that provides Effect-style programming with minimal overhead.

### Performance Comparison

```
=== MICRO RPC BUILDER BENCHMARK ===

Query - No Effect import:       89ms (baseline)
Query - MicroRpcBuilder:        94ms (+5.2ms, +5.8%)
Query - Raw Micro+Context:      95ms (+6ms, +6.9%)
Query - Full Effect RPC:        132ms (+43ms, +48%)

Mutation - No Effect import:    115ms (baseline)
Mutation - MicroRpcBuilder:     120ms (+4.9ms, +4.2%)
Mutation - Raw Micro+Context:   123ms (+8.6ms, +7.5%)
Mutation - Full Effect RPC:     148ms (+33ms, +29%)

SAVINGS WITH MICRO RPC BUILDER:
Query savings vs Effect RPC:    37.73ms (28.6% faster)
Mutation savings vs Effect RPC: 28.21ms (19.1% faster)
```

### What MicroRpcBuilder Provides

- `Micro.gen`, `Micro.service`, `Micro.promise` - Core execution
- `Context.Tag` for dependency injection (`MicroQueryCtx`, `MicroMutationCtx`, `MicroActionCtx`)
- `MicroExit` encoding for type-safe error handling
- All 6 endpoint types: query, mutation, action + internal variants
- `makeMicroRpcModule` for building modules

### What Micro Does NOT Provide (vs full Effect)

- **No Layers** - Use direct `provideService` instead
- **No Schema** - Uses Convex validators directly via `v` from `convex/values`
- **No @effect/rpc compatibility** - Custom RPC layer
- **No Effect.exit** - Uses simpler `MicroExit` format

## Usage Example

### Server-side (MicroRpcBuilder)

```typescript
import { createMicroRpcFactory, makeMicroRpcModule, MicroMutationCtx, MicroQueryCtx, v, Micro } from "@packages/confect/rpc/micro";

const microRpc = createMicroRpcFactory();

const module = makeMicroRpcModule({
  list: microRpc.query({ _cacheKey: v.optional(v.string()) }, (_args) =>
    Micro.gen(function* () {
      const ctx = yield* Micro.service(MicroQueryCtx);
      return yield* Micro.promise(() => ctx.db.query("table").collect());
    })
  ),
  create: microRpc.mutation({ name: v.string() }, (args) =>
    Micro.gen(function* () {
      const ctx = yield* Micro.service(MicroMutationCtx);
      return yield* Micro.promise(() => ctx.db.insert("table", args));
    })
  ),
});

export const { list, create } = module.handlers;
```

### Client-side (MicroRpcClient)

```typescript
import { decodeMicroExit, decodeMicroExitSafe, useMicroExit, useMicroExitWithError } from "@packages/confect/rpc/micro-client";

// Throws on failure
const value = decodeMicroExit(exit);

// Returns { success, value/error }
const result = decodeMicroExitSafe(exit);

// React hook friendly
const data = useMicroExit(exit); // undefined on failure
const { data, error, defect } = useMicroExitWithError(exit);
```

## Raw Benchmark Data

### Effect Without Schema Test

```
=== EFFECT WITHOUT SCHEMA BENCHMARK ===

--- QUERIES ---
Query - No Effect import         : 88.54ms avg
Query - effect/Micro only        : 93.23ms avg  (+4.69ms, 5.3%)
Query - Effect WITHOUT Schema    : 109.94ms avg (+21.40ms, 24.2%)
Query - Effect WITH Schema       : 110.26ms avg (+21.72ms, 24.5%)
Query - Full Effect RPC          : 129.95ms avg (+41.41ms, 46.8%)

--- MUTATIONS ---
Mutation - No Effect import         : 119.50ms avg
Mutation - effect/Micro only        : 123.65ms avg (+4.15ms, 3.5%)
Mutation - Effect WITHOUT Schema    : 139.31ms avg (+19.80ms, 16.6%)
Mutation - Effect WITH Schema       : 137.68ms avg (+18.17ms, 15.2%)
Mutation - Full Effect RPC          : 147.15ms avg (+27.65ms, 23.1%)
```

### Import Strategy Comparison

```
--- QUERIES (with cache busting) ---
Query - No Effect import      : 88.28ms avg
Query - effect/Micro import   : 93.32ms avg  (+5.04ms, 5.7%)
Query - effect/Effect submod  : 105.06ms avg (+16.78ms, 19.0%)
Query - effect (main entry)   : 110.36ms avg (+22.08ms, 25.0%)
Query - @effect/rpc only      : 132ms avg    (+43.72ms, 49.5%)

--- MUTATIONS ---
Mutation - No Effect import      : 115.44ms avg
Mutation - effect/Micro import   : 118.85ms avg (+3.41ms, 3.0%)
Mutation - effect/Effect submod  : 136.96ms avg (+21.52ms, 18.6%)
Mutation - effect (main entry)   : 134.91ms avg (+19.47ms, 16.9%)
Mutation - @effect/rpc only      : 148ms avg    (+32.56ms, 28.2%)
```

## Recommendations

### When to Use MicroRpcBuilder
- Latency-critical endpoints
- Simple CRUD operations
- High-traffic queries/mutations
- When you want Effect-style DI without the overhead

### When to Use Full Effect RPC
- Complex business logic requiring Layers
- Need Schema validation features
- Integration with @effect/rpc ecosystem
- When ~40ms overhead is acceptable

### Hybrid Approach
Use MicroRpcBuilder for hot paths, Full Effect RPC for complex workflows.

## Files

- `packages/confect/src/rpc/MicroRpcBuilder.ts` - Server-side RPC factory
- `packages/confect/src/rpc/MicroRpcClient.ts` - Client-side utilities
- `packages/database/convex/benchmark/` - All benchmark files
- `packages/database/benchmark/benchmark.test.ts` - Benchmark tests

## Running Benchmarks

```bash
cd packages/database
bun run with-env convex dev --once  # Deploy functions
bun test benchmark -t "MicroRpcBuilder"  # MicroRpcBuilder benchmarks
bun test benchmark -t "Effect Without Schema"  # Schema isolation test
bun test benchmark  # All benchmarks
```
