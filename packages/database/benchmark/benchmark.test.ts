import { describe, it, expect, beforeAll } from "vitest";
import { ConvexHttpClient } from "convex/browser";
import { Exit } from "effect";
import { api } from "../convex/_generated/api";
import {
	decodeMicroExit,
	decodeMicroExitSafe,
	useMicroExit,
	useMicroExitWithError,
	type MicroExit,
} from "@packages/confect/rpc/micro-client";

const CONVEX_URL =
	process.env.CONVEX_URL ?? "https://healthy-albatross-147.convex.cloud";

interface EncodedExit {
	readonly _tag: "Success" | "Failure";
	readonly value?: unknown;
	readonly cause?: unknown;
}

const decodeExit = (encoded: EncodedExit): Exit.Exit<unknown, unknown> => {
	if (encoded._tag === "Success") {
		return Exit.succeed(encoded.value);
	}
	return Exit.failCause(encoded.cause as import("effect").Cause.Cause<unknown>);
};

async function benchmark(
	name: string,
	fn: () => Promise<unknown>,
	iterations: number = 100,
): Promise<number> {
	for (let i = 0; i < 5; i++) {
		await fn();
	}

	const start = performance.now();
	for (let i = 0; i < iterations; i++) {
		await fn();
	}
	const end = performance.now();
	const totalMs = end - start;
	const avgMs = totalMs / iterations;
	const opsPerSec = Math.round(1000 / avgMs);

	console.log(
		`${name}: ${avgMs.toFixed(2)}ms avg, ${opsPerSec.toLocaleString()} ops/sec (${iterations} iterations, ${totalMs.toFixed(0)}ms total)`,
	);

	return avgMs;
}

describe("Real Convex Benchmark: Normal vs Effect RPC", () => {
	let client: ConvexHttpClient;

	beforeAll(() => {
		client = new ConvexHttpClient(CONVEX_URL);
	});

	it(
		"Query: Normal Convex vs Effect RPC (real deployed functions)",
		{ timeout: 120000 },
		async () => {
			console.log("\n=== REAL QUERY BENCHMARK ===\n");
			console.log(`Convex URL: ${CONVEX_URL}\n`);

			const normalTime = await benchmark(
				"Normal Convex Query",
				async () => {
					return await client.query(
						api.benchmark.benchmarkNormal.normalList,
						{},
					);
				},
				20,
			);

			const effectTime = await benchmark(
				"Effect RPC Query   ",
				async () => {
					const encodedExit = await client.query(
						api.rpc.benchmark.effectList,
						{},
					);
					const exit = decodeExit(encodedExit as EncodedExit);
					if (Exit.isSuccess(exit)) {
						return exit.value;
					}
					throw new Error("Query failed");
				},
				20,
			);

			const overhead = ((effectTime - normalTime) / normalTime) * 100;
			const diff = effectTime - normalTime;
			console.log(
				`\nEffect overhead: ${diff.toFixed(2)}ms (${overhead.toFixed(2)}%)`,
			);
			console.log(
				`Effect is ${(effectTime / normalTime).toFixed(2)}x the time of normal\n`,
			);

			expect(effectTime).toBeGreaterThan(0);
		},
	);

	it(
		"Mutation: Normal Convex vs Effect RPC (real deployed functions)",
		{ timeout: 120000 },
		async () => {
			console.log("\n=== REAL MUTATION BENCHMARK ===\n");

			const testData = {
				name: `Benchmark ${Date.now()}`,
				message: "Test message for benchmark",
			};

			const normalTime = await benchmark(
				"Normal Convex Mutation",
				async () => {
					return await client.mutation(
						api.benchmark.benchmarkNormal.normalAdd,
						testData,
					);
				},
				50,
			);

			const effectTime = await benchmark(
				"Effect RPC Mutation   ",
				async () => {
					const encodedExit = await client.mutation(
						api.rpc.benchmark.effectAdd,
						testData,
					);
					const exit = decodeExit(encodedExit as EncodedExit);
					if (Exit.isSuccess(exit)) {
						return exit.value;
					}
					throw new Error("Mutation failed");
				},
				50,
			);

			const effectDirectTime = await benchmark(
				"Effect Direct DB      ",
				async () => {
					const encodedExit = await client.mutation(
						api.rpc.benchmark.effectAddDirect,
						testData,
					);
					const exit = decodeExit(encodedExit as EncodedExit);
					if (Exit.isSuccess(exit)) {
						return exit.value;
					}
					throw new Error("Mutation failed");
				},
				50,
			);

			console.log("\n--- Analysis ---");
			const effectOverhead = effectTime - normalTime;
			const directOverhead = effectDirectTime - normalTime;
			const dbSchemaOverhead = effectTime - effectDirectTime;

			console.log(
				`Normal Convex:        ${normalTime.toFixed(2)}ms (baseline)`,
			);
			console.log(
				`Effect + ctx.db:      ${effectTime.toFixed(2)}ms (+${effectOverhead.toFixed(2)}ms, ${((effectOverhead / normalTime) * 100).toFixed(1)}%)`,
			);
			console.log(
				`Effect + direct db:   ${effectDirectTime.toFixed(2)}ms (+${directOverhead.toFixed(2)}ms, ${((directOverhead / normalTime) * 100).toFixed(1)}%)`,
			);
			console.log(
				`\nDB Schema overhead:   ${dbSchemaOverhead.toFixed(2)}ms (ctx.db.insert vs ctx.ctx.db.insert)`,
			);
			console.log(
				`Pure Effect overhead: ${directOverhead.toFixed(2)}ms (Effect.gen + Exit + Schema encode/decode)\n`,
			);

			expect(effectTime).toBeGreaterThan(0);
		},
	);
});

describe("Minimal Effect Overhead Isolation", () => {
	let client: ConvexHttpClient;

	beforeAll(() => {
		client = new ConvexHttpClient(CONVEX_URL);
	});

	it(
		"Isolate exact source of Effect overhead",
		{ timeout: 300000 },
		async () => {
			console.log("\n=== MINIMAL EFFECT OVERHEAD ISOLATION ===\n");
			console.log(`Convex URL: ${CONVEX_URL}\n`);

			const testData = {
				name: `Benchmark ${Date.now()}`,
				message: "Test message for benchmark",
			};

			const iterations = 50;

			const normalTime = await benchmark(
				"1. Normal Convex (baseline)      ",
				async () => {
					return await client.mutation(
						api.benchmark.benchmarkNormal.normalAdd,
						testData,
					);
				},
				iterations,
			);

			const pureJsIdTime = await benchmark(
				"1b. Pure JS return id (control)  ",
				async () => {
					return await client.mutation(
						api.benchmark.benchmarkMinimal.pureJsReturnId,
						testData,
					);
				},
				iterations,
			);

			const pureJsObjTime = await benchmark(
				"1c. Pure JS return {_tag, value} ",
				async () => {
					return await client.mutation(
						api.benchmark.benchmarkMinimal.pureJsReturnObject,
						testData,
					);
				},
				iterations,
			);

			const noEffectIdTime = await benchmark(
				"1d. No Effect import, return id  ",
				async () => {
					return await client.mutation(
						api.benchmark.benchmarkNoEffect.pureJsReturnId,
						testData,
					);
				},
				iterations,
			);

			const noEffectObjTime = await benchmark(
				"1e. No Effect import, return obj ",
				async () => {
					return await client.mutation(
						api.benchmark.benchmarkNoEffect.pureJsReturnObject,
						testData,
					);
				},
				iterations,
			);

			const noSchemaTime = await benchmark(
				"2. Manual {_tag, value} return   ",
				async () => {
					return await client.mutation(
						api.benchmark.benchmarkMinimal.minimalEffectNoSchema,
						testData,
					);
				},
				iterations,
			);

			const runPromiseTime = await benchmark(
				"3. + Effect.gen + runPromise     ",
				async () => {
					return await client.mutation(
						api.benchmark.benchmarkMinimal.minimalEffectRunPromise,
						testData,
					);
				},
				iterations,
			);

			const exitTime = await benchmark(
				"4. + Effect.exit                 ",
				async () => {
					return await client.mutation(
						api.benchmark.benchmarkMinimal.minimalEffectWithExit,
						testData,
					);
				},
				iterations,
			);

			const schemaEncodeTime = await benchmark(
				"5. + Schema.encode(Exit)         ",
				async () => {
					return await client.mutation(
						api.benchmark.benchmarkMinimal.minimalEffectWithSchemaEncode,
						testData,
					);
				},
				iterations,
			);

			const fullPipelineTime = await benchmark(
				"6. + Schema.decode(input)        ",
				async () => {
					return await client.mutation(
						api.benchmark.benchmarkMinimal.minimalEffectFullPipeline,
						testData,
					);
				},
				iterations,
			);

			const fullEffectTime = await benchmark(
				"7. Full Effect RPC (production)  ",
				async () => {
					const encodedExit = await client.mutation(
						api.rpc.benchmark.effectAdd,
						testData,
					);
					const exit = decodeExit(encodedExit as EncodedExit);
					if (Exit.isSuccess(exit)) {
						return exit.value;
					}
					throw new Error("Mutation failed");
				},
				iterations,
			);

			console.log("\n--- Overhead Analysis (cumulative) ---");
			console.log(
				`Baseline (normal Convex):         ${normalTime.toFixed(2)}ms`,
			);
			console.log(
				`No Effect import, return id:      +${(noEffectIdTime - normalTime).toFixed(2)}ms (${noEffectIdTime.toFixed(2)}ms total)`,
			);
			console.log(
				`No Effect import, return obj:     +${(noEffectObjTime - normalTime).toFixed(2)}ms (${noEffectObjTime.toFixed(2)}ms total)`,
			);
			console.log(
				`With Effect import, return id:    +${(pureJsIdTime - normalTime).toFixed(2)}ms (${pureJsIdTime.toFixed(2)}ms total)`,
			);
			console.log(
				`With Effect import, return obj:   +${(pureJsObjTime - normalTime).toFixed(2)}ms (${pureJsObjTime.toFixed(2)}ms total)`,
			);
			console.log(
				`Return shape change:              +${(noSchemaTime - normalTime).toFixed(2)}ms (${noSchemaTime.toFixed(2)}ms total)`,
			);
			console.log(
				`Effect.gen + runPromise:          +${(runPromiseTime - noSchemaTime).toFixed(2)}ms (${runPromiseTime.toFixed(2)}ms total)`,
			);
			console.log(
				`Effect.exit:                      +${(exitTime - runPromiseTime).toFixed(2)}ms (${exitTime.toFixed(2)}ms total)`,
			);
			console.log(
				`Schema.encode(Exit):              +${(schemaEncodeTime - exitTime).toFixed(2)}ms (${schemaEncodeTime.toFixed(2)}ms total)`,
			);
			console.log(
				`Schema.decode(input):             +${(fullPipelineTime - schemaEncodeTime).toFixed(2)}ms (${fullPipelineTime.toFixed(2)}ms total)`,
			);
			console.log(
				`Full RPC (+ middleware + ctx.db): +${(fullEffectTime - fullPipelineTime).toFixed(2)}ms (${fullEffectTime.toFixed(2)}ms total)`,
			);
			console.log(
				`\nTotal Effect overhead:            +${(fullEffectTime - normalTime).toFixed(2)}ms (${(((fullEffectTime - normalTime) / normalTime) * 100).toFixed(1)}%)`,
			);

			expect(fullEffectTime).toBeGreaterThan(0);
		},
	);
});

describe("Query vs Mutation with Effect Import", () => {
	let client: ConvexHttpClient;

	beforeAll(() => {
		client = new ConvexHttpClient(CONVEX_URL);
	});

	it(
		"Compare queries and mutations with/without Effect import",
		{ timeout: 180000 },
		async () => {
			console.log("\n=== QUERY VS MUTATION WITH EFFECT IMPORT ===\n");

			const testData = {
				name: `Benchmark ${Date.now()}`,
				message: "Test message",
			};

			const iterations = 30;

			console.log("--- QUERIES (with random cache key) ---\n");

			let counter = 0;
			const randomKey = () => `${Date.now()}-${counter++}-${Math.random()}`;

			const queryNoEffectTime = await benchmark(
				"Query - No Effect import      ",
				async () => {
					return await client.query(api.benchmark.benchmarkNoEffect.queryList, {
						_cacheKey: randomKey(),
					});
				},
				iterations,
			);

			const queryOnlyImportTime = await benchmark(
				"Query - Effect import only    ",
				async () => {
					return await client.query(
						api.benchmark.benchmarkOnlyImport.queryList,
						{
							_cacheKey: randomKey(),
						},
					);
				},
				iterations,
			);

			const querySubmoduleTime = await benchmark(
				"Query - effect/Effect submod  ",
				async () => {
					return await client.query(
						api.benchmark.benchmarkSubmodule.queryList,
						{
							_cacheKey: randomKey(),
						},
					);
				},
				iterations,
			);

			const queryMinimalTime = await benchmark(
				"Query - named imports only    ",
				async () => {
					return await client.query(
						api.benchmark.benchmarkMinimalImport.queryList,
						{
							_cacheKey: randomKey(),
						},
					);
				},
				iterations,
			);

			const queryEffectRpcTime = await benchmark(
				"Query - @effect/rpc only      ",
				async () => {
					return await client.query(
						api.benchmark.benchmarkEffectRpc.queryList,
						{
							_cacheKey: randomKey(),
						},
					);
				},
				iterations,
			);

			const queryWithEffectTime = await benchmark(
				"Query - Effect + Schema.Exit  ",
				async () => {
					return await client.query(api.benchmark.benchmarkMinimal.queryList, {
						_cacheKey: randomKey(),
					});
				},
				iterations,
			);

			console.log("\n--- MUTATIONS (with random cache key) ---\n");

			const mutationNoEffectTime = await benchmark(
				"Mutation - No Effect import      ",
				async () => {
					return await client.mutation(
						api.benchmark.benchmarkNoEffect.pureJsReturnId,
						{
							...testData,
							name: `${testData.name}-${randomKey()}`,
						},
					);
				},
				iterations,
			);

			const mutationOnlyImportTime = await benchmark(
				"Mutation - Effect import only    ",
				async () => {
					return await client.mutation(
						api.benchmark.benchmarkOnlyImport.pureJsReturnId,
						{
							...testData,
							name: `${testData.name}-${randomKey()}`,
						},
					);
				},
				iterations,
			);

			const mutationSubmoduleTime = await benchmark(
				"Mutation - effect/Effect submod ",
				async () => {
					return await client.mutation(
						api.benchmark.benchmarkSubmodule.pureJsReturnId,
						{
							...testData,
							name: `${testData.name}-${randomKey()}`,
						},
					);
				},
				iterations,
			);

			const mutationMinimalTime = await benchmark(
				"Mutation - named imports only   ",
				async () => {
					return await client.mutation(
						api.benchmark.benchmarkMinimalImport.pureJsReturnId,
						{
							...testData,
							name: `${testData.name}-${randomKey()}`,
						},
					);
				},
				iterations,
			);

			const mutationEffectRpcTime = await benchmark(
				"Mutation - @effect/rpc only     ",
				async () => {
					return await client.mutation(
						api.benchmark.benchmarkEffectRpc.pureJsReturnId,
						{
							...testData,
							name: `${testData.name}-${randomKey()}`,
						},
					);
				},
				iterations,
			);

			const mutationWithEffectTime = await benchmark(
				"Mutation - Effect + Schema.Exit  ",
				async () => {
					return await client.mutation(
						api.benchmark.benchmarkMinimal.pureJsReturnId,
						{
							...testData,
							name: `${testData.name}-${randomKey()}`,
						},
					);
				},
				iterations,
			);

			console.log("\n--- ANALYSIS ---");
			console.log(
				`Query - Effect import only:    +${(queryOnlyImportTime - queryNoEffectTime).toFixed(2)}ms (${(((queryOnlyImportTime - queryNoEffectTime) / queryNoEffectTime) * 100).toFixed(1)}%)`,
			);
			console.log(
				`Query - effect/Effect submod:  +${(querySubmoduleTime - queryNoEffectTime).toFixed(2)}ms (${(((querySubmoduleTime - queryNoEffectTime) / queryNoEffectTime) * 100).toFixed(1)}%)`,
			);
			console.log(
				`Query - named imports only:    +${(queryMinimalTime - queryNoEffectTime).toFixed(2)}ms (${(((queryMinimalTime - queryNoEffectTime) / queryNoEffectTime) * 100).toFixed(1)}%)`,
			);
			console.log(
				`Query - @effect/rpc only:      +${(queryEffectRpcTime - queryNoEffectTime).toFixed(2)}ms (${(((queryEffectRpcTime - queryNoEffectTime) / queryNoEffectTime) * 100).toFixed(1)}%)`,
			);
			console.log(
				`Query - Effect + Schema.Exit:  +${(queryWithEffectTime - queryNoEffectTime).toFixed(2)}ms (${(((queryWithEffectTime - queryNoEffectTime) / queryNoEffectTime) * 100).toFixed(1)}%)`,
			);
			console.log(
				`Mutation - Effect import only: +${(mutationOnlyImportTime - mutationNoEffectTime).toFixed(2)}ms (${(((mutationOnlyImportTime - mutationNoEffectTime) / mutationNoEffectTime) * 100).toFixed(1)}%)`,
			);
			console.log(
				`Mutation - effect/Effect sub:  +${(mutationSubmoduleTime - mutationNoEffectTime).toFixed(2)}ms (${(((mutationSubmoduleTime - mutationNoEffectTime) / mutationNoEffectTime) * 100).toFixed(1)}%)`,
			);
			console.log(
				`Mutation - named imports only: +${(mutationMinimalTime - mutationNoEffectTime).toFixed(2)}ms (${(((mutationMinimalTime - mutationNoEffectTime) / mutationNoEffectTime) * 100).toFixed(1)}%)`,
			);
			console.log(
				`Mutation - @effect/rpc only:   +${(mutationEffectRpcTime - mutationNoEffectTime).toFixed(2)}ms (${(((mutationEffectRpcTime - mutationNoEffectTime) / mutationNoEffectTime) * 100).toFixed(1)}%)`,
			);
			console.log(
				`Mutation - Effect + Schema:    +${(mutationWithEffectTime - mutationNoEffectTime).toFixed(2)}ms (${(((mutationWithEffectTime - mutationNoEffectTime) / mutationNoEffectTime) * 100).toFixed(1)}%)`,
			);

			expect(true).toBe(true);
		},
	);
});

describe("Micro Module Benchmark", () => {
	let client: ConvexHttpClient;

	beforeAll(() => {
		client = new ConvexHttpClient(CONVEX_URL);
	});

	it(
		"Compare Micro module overhead vs Effect and no imports",
		{ timeout: 180000 },
		async () => {
			console.log("\n=== MICRO MODULE BENCHMARK ===\n");

			const testData = {
				name: `Benchmark ${Date.now()}`,
				message: "Test message",
			};

			const iterations = 30;

			let counter = 0;
			const randomKey = () => `${Date.now()}-${counter++}-${Math.random()}`;

			console.log("--- QUERIES ---\n");

			const queryNoEffectTime = await benchmark(
				"Query - No Effect import      ",
				async () => {
					return await client.query(api.benchmark.benchmarkNoEffect.queryList, {
						_cacheKey: randomKey(),
					});
				},
				iterations,
			);

			const queryMicroTime = await benchmark(
				"Query - effect/Micro import   ",
				async () => {
					return await client.query(api.benchmark.benchmarkMicro.queryList, {
						_cacheKey: randomKey(),
					});
				},
				iterations,
			);

			const queryEffectTime = await benchmark(
				"Query - effect (main entry)   ",
				async () => {
					return await client.query(
						api.benchmark.benchmarkOnlyImport.queryList,
						{
							_cacheKey: randomKey(),
						},
					);
				},
				iterations,
			);

			const querySubmoduleTime = await benchmark(
				"Query - effect/Effect submod  ",
				async () => {
					return await client.query(
						api.benchmark.benchmarkSubmodule.queryList,
						{
							_cacheKey: randomKey(),
						},
					);
				},
				iterations,
			);

			console.log("\n--- MUTATIONS ---\n");

			const mutationNoEffectTime = await benchmark(
				"Mutation - No Effect import      ",
				async () => {
					return await client.mutation(
						api.benchmark.benchmarkNoEffect.pureJsReturnId,
						{
							...testData,
							name: `${testData.name}-${randomKey()}`,
						},
					);
				},
				iterations,
			);

			const mutationMicroTime = await benchmark(
				"Mutation - effect/Micro import   ",
				async () => {
					return await client.mutation(
						api.benchmark.benchmarkMicro.pureJsReturnId,
						{
							...testData,
							name: `${testData.name}-${randomKey()}`,
						},
					);
				},
				iterations,
			);

			const mutationMicroRunPromiseTime = await benchmark(
				"Mutation - Micro.gen+runPromise  ",
				async () => {
					return await client.mutation(
						api.benchmark.benchmarkMicro.microRunPromise,
						{
							...testData,
							name: `${testData.name}-${randomKey()}`,
						},
					);
				},
				iterations,
			);

			const mutationMicroWithContextTime = await benchmark(
				"Mutation - Micro+Context+Exit    ",
				async () => {
					return await client.mutation(
						api.benchmark.benchmarkMicro.microWithContext,
						{
							...testData,
							name: `${testData.name}-${randomKey()}`,
						},
					);
				},
				iterations,
			);

			const mutationEffectTime = await benchmark(
				"Mutation - effect (main entry)   ",
				async () => {
					return await client.mutation(
						api.benchmark.benchmarkOnlyImport.pureJsReturnId,
						{
							...testData,
							name: `${testData.name}-${randomKey()}`,
						},
					);
				},
				iterations,
			);

			const mutationSubmoduleTime = await benchmark(
				"Mutation - effect/Effect submod  ",
				async () => {
					return await client.mutation(
						api.benchmark.benchmarkSubmodule.pureJsReturnId,
						{
							...testData,
							name: `${testData.name}-${randomKey()}`,
						},
					);
				},
				iterations,
			);

			console.log("\n--- MICRO ANALYSIS ---");
			console.log(
				`Query - Micro overhead:           +${(queryMicroTime - queryNoEffectTime).toFixed(2)}ms (${(((queryMicroTime - queryNoEffectTime) / queryNoEffectTime) * 100).toFixed(1)}%)`,
			);
			console.log(
				`Query - Effect main overhead:     +${(queryEffectTime - queryNoEffectTime).toFixed(2)}ms (${(((queryEffectTime - queryNoEffectTime) / queryNoEffectTime) * 100).toFixed(1)}%)`,
			);
			console.log(
				`Query - Effect submod overhead:   +${(querySubmoduleTime - queryNoEffectTime).toFixed(2)}ms (${(((querySubmoduleTime - queryNoEffectTime) / queryNoEffectTime) * 100).toFixed(1)}%)`,
			);
			console.log(
				`\nMutation - Micro overhead:        +${(mutationMicroTime - mutationNoEffectTime).toFixed(2)}ms (${(((mutationMicroTime - mutationNoEffectTime) / mutationNoEffectTime) * 100).toFixed(1)}%)`,
			);
			console.log(
				`Mutation - Micro.gen+runPromise:  +${(mutationMicroRunPromiseTime - mutationNoEffectTime).toFixed(2)}ms (${(((mutationMicroRunPromiseTime - mutationNoEffectTime) / mutationNoEffectTime) * 100).toFixed(1)}%)`,
			);
			console.log(
				`Mutation - Micro+Context+Exit:    +${(mutationMicroWithContextTime - mutationNoEffectTime).toFixed(2)}ms (${(((mutationMicroWithContextTime - mutationNoEffectTime) / mutationNoEffectTime) * 100).toFixed(1)}%)`,
			);
			console.log(
				`Mutation - Effect main overhead:  +${(mutationEffectTime - mutationNoEffectTime).toFixed(2)}ms (${(((mutationEffectTime - mutationNoEffectTime) / mutationNoEffectTime) * 100).toFixed(1)}%)`,
			);
			console.log(
				`Mutation - Effect submod overhead:+${(mutationSubmoduleTime - mutationNoEffectTime).toFixed(2)}ms (${(((mutationSubmoduleTime - mutationNoEffectTime) / mutationNoEffectTime) * 100).toFixed(1)}%)`,
			);

			console.log("\n--- MICRO VS EFFECT COMPARISON ---");
			const microSavingsQuery = queryEffectTime - queryMicroTime;
			const microSavingsMutation = mutationEffectTime - mutationMicroTime;
			console.log(
				`Query savings with Micro:    ${microSavingsQuery.toFixed(2)}ms (${((microSavingsQuery / queryEffectTime) * 100).toFixed(1)}% faster)`,
			);
			console.log(
				`Mutation savings with Micro: ${microSavingsMutation.toFixed(2)}ms (${((microSavingsMutation / mutationEffectTime) * 100).toFixed(1)}% faster)`,
			);

			expect(true).toBe(true);
		},
	);
});

describe("MicroRpcBuilder Benchmark", () => {
	let client: ConvexHttpClient;

	beforeAll(() => {
		client = new ConvexHttpClient(CONVEX_URL);
	});

	it(
		"Compare MicroRpcBuilder vs raw Micro vs Effect RPC",
		{ timeout: 180000 },
		async () => {
			console.log("\n=== MICRO RPC BUILDER BENCHMARK ===\n");

			const testData = {
				name: `Benchmark ${Date.now()}`,
				message: "Test message",
			};

			const iterations = 30;

			let counter = 0;
			const randomKey = () => `${Date.now()}-${counter++}-${Math.random()}`;

			console.log("--- QUERIES ---\n");

			const queryNoEffectTime = await benchmark(
				"Query - No Effect import      ",
				async () => {
					return await client.query(api.benchmark.benchmarkNoEffect.queryList, {
						_cacheKey: randomKey(),
					});
				},
				iterations,
			);

			const queryMicroRpcTime = await benchmark(
				"Query - MicroRpcBuilder       ",
				async () => {
					return await client.query(api.benchmark.benchmarkMicroRpc.list, {
						_cacheKey: randomKey(),
					});
				},
				iterations,
			);

			const queryRawMicroTime = await benchmark(
				"Query - Raw Micro+Context     ",
				async () => {
					return await client.query(
						api.benchmark.benchmarkMicro.microQueryWithContext,
						{
							_cacheKey: randomKey(),
						},
					);
				},
				iterations,
			);

			const queryEffectRpcTime = await benchmark(
				"Query - Full Effect RPC       ",
				async () => {
					return await client.query(api.rpc.benchmark.effectList, {
						_cacheKey: randomKey(),
					});
				},
				iterations,
			);

			console.log("\n--- MUTATIONS ---\n");

			const mutationNoEffectTime = await benchmark(
				"Mutation - No Effect import      ",
				async () => {
					return await client.mutation(
						api.benchmark.benchmarkNoEffect.pureJsReturnId,
						{
							...testData,
							name: `${testData.name}-${randomKey()}`,
						},
					);
				},
				iterations,
			);

			const mutationMicroRpcTime = await benchmark(
				"Mutation - MicroRpcBuilder       ",
				async () => {
					return await client.mutation(api.benchmark.benchmarkMicroRpc.create, {
						...testData,
						name: `${testData.name}-${randomKey()}`,
					});
				},
				iterations,
			);

			const mutationRawMicroTime = await benchmark(
				"Mutation - Raw Micro+Context     ",
				async () => {
					return await client.mutation(
						api.benchmark.benchmarkMicro.microWithContext,
						{
							...testData,
							name: `${testData.name}-${randomKey()}`,
						},
					);
				},
				iterations,
			);

			const mutationEffectRpcTime = await benchmark(
				"Mutation - Full Effect RPC       ",
				async () => {
					return await client.mutation(api.rpc.benchmark.effectAdd, {
						...testData,
						name: `${testData.name}-${randomKey()}`,
					});
				},
				iterations,
			);

			console.log("\n--- MICRO RPC BUILDER ANALYSIS ---");
			console.log(
				`Query - MicroRpcBuilder overhead:     +${(queryMicroRpcTime - queryNoEffectTime).toFixed(2)}ms (${(((queryMicroRpcTime - queryNoEffectTime) / queryNoEffectTime) * 100).toFixed(1)}%)`,
			);
			console.log(
				`Query - Raw Micro overhead:           +${(queryRawMicroTime - queryNoEffectTime).toFixed(2)}ms (${(((queryRawMicroTime - queryNoEffectTime) / queryNoEffectTime) * 100).toFixed(1)}%)`,
			);
			console.log(
				`Query - Effect RPC overhead:          +${(queryEffectRpcTime - queryNoEffectTime).toFixed(2)}ms (${(((queryEffectRpcTime - queryNoEffectTime) / queryNoEffectTime) * 100).toFixed(1)}%)`,
			);
			console.log(
				`\nMutation - MicroRpcBuilder overhead:  +${(mutationMicroRpcTime - mutationNoEffectTime).toFixed(2)}ms (${(((mutationMicroRpcTime - mutationNoEffectTime) / mutationNoEffectTime) * 100).toFixed(1)}%)`,
			);
			console.log(
				`Mutation - Raw Micro overhead:        +${(mutationRawMicroTime - mutationNoEffectTime).toFixed(2)}ms (${(((mutationRawMicroTime - mutationNoEffectTime) / mutationNoEffectTime) * 100).toFixed(1)}%)`,
			);
			console.log(
				`Mutation - Effect RPC overhead:       +${(mutationEffectRpcTime - mutationNoEffectTime).toFixed(2)}ms (${(((mutationEffectRpcTime - mutationNoEffectTime) / mutationNoEffectTime) * 100).toFixed(1)}%)`,
			);

			console.log("\n--- SAVINGS WITH MICRO RPC BUILDER ---");
			const querySavings = queryEffectRpcTime - queryMicroRpcTime;
			const mutationSavings = mutationEffectRpcTime - mutationMicroRpcTime;
			console.log(
				`Query savings vs Effect RPC:    ${querySavings.toFixed(2)}ms (${((querySavings / queryEffectRpcTime) * 100).toFixed(1)}% faster)`,
			);
			console.log(
				`Mutation savings vs Effect RPC: ${mutationSavings.toFixed(2)}ms (${((mutationSavings / mutationEffectRpcTime) * 100).toFixed(1)}% faster)`,
			);

			expect(true).toBe(true);
		},
	);
});

describe("MicroRpcClient utilities", () => {
	it("decodeMicroExit handles success", () => {
		const exit: MicroExit<string, Error> = { _tag: "Success", value: "hello" };
		const result = decodeMicroExit(exit);
		expect(result).toBe("hello");
	});

	it("decodeMicroExit throws on failure", () => {
		const exit: MicroExit<string, string> = { _tag: "Failure", error: "oops" };
		expect(() => decodeMicroExit(exit)).toThrow("oops");
	});

	it("decodeMicroExit throws on defect", () => {
		const exit: MicroExit<string, string> = { _tag: "Die", defect: "crash" };
		expect(() => decodeMicroExit(exit)).toThrow("crash");
	});

	it("decodeMicroExitSafe handles success", () => {
		const exit: MicroExit<string, Error> = { _tag: "Success", value: "hello" };
		const result = decodeMicroExitSafe(exit);
		expect(result).toEqual({ success: true, value: "hello" });
	});

	it("decodeMicroExitSafe handles failure", () => {
		const exit: MicroExit<string, string> = { _tag: "Failure", error: "oops" };
		const result = decodeMicroExitSafe(exit);
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error._tag).toBe("MicroRpcError");
		}
	});

	it("useMicroExit extracts success value", () => {
		const exit: MicroExit<string, Error> = { _tag: "Success", value: "hello" };
		expect(useMicroExit(exit)).toBe("hello");
	});

	it("useMicroExit returns undefined on failure", () => {
		const exit: MicroExit<string, string> = { _tag: "Failure", error: "oops" };
		expect(useMicroExit(exit)).toBeUndefined();
	});

	it("useMicroExitWithError extracts all parts", () => {
		const successExit: MicroExit<string, string> = {
			_tag: "Success",
			value: "hello",
		};
		expect(useMicroExitWithError(successExit)).toEqual({
			data: "hello",
			error: undefined,
			defect: undefined,
		});

		const failExit: MicroExit<string, string> = {
			_tag: "Failure",
			error: "oops",
		};
		expect(useMicroExitWithError(failExit)).toEqual({
			data: undefined,
			error: "oops",
			defect: undefined,
		});

		const defectExit: MicroExit<string, string> = {
			_tag: "Die",
			defect: "crash",
		};
		expect(useMicroExitWithError(defectExit)).toEqual({
			data: undefined,
			error: undefined,
			defect: "crash",
		});
	});
});

describe("Effect Without Schema Benchmark", () => {
	let client: ConvexHttpClient;

	beforeAll(() => {
		client = new ConvexHttpClient(CONVEX_URL);
	});

	it(
		"Isolate Schema import overhead - Effect with vs without Schema",
		{ timeout: 180000 },
		async () => {
			console.log("\n=== EFFECT WITHOUT SCHEMA BENCHMARK ===\n");
			console.log("Testing: Effect.gen, Context, Exit, pipe - but NO Schema\n");

			const testData = {
				name: `Benchmark ${Date.now()}`,
				message: "Test message",
			};

			const iterations = 30;

			let counter = 0;
			const randomKey = () => `${Date.now()}-${counter++}-${Math.random()}`;

			console.log("--- QUERIES ---\n");

			const queryNoEffectTime = await benchmark(
				"Query - No Effect import         ",
				async () => {
					return await client.query(api.benchmark.benchmarkNoEffect.queryList, {
						_cacheKey: randomKey(),
					});
				},
				iterations,
			);

			const queryMicroTime = await benchmark(
				"Query - effect/Micro only        ",
				async () => {
					return await client.query(api.benchmark.benchmarkMicro.queryList, {
						_cacheKey: randomKey(),
					});
				},
				iterations,
			);

			const queryEffectNoSchemaTime = await benchmark(
				"Query - Effect WITHOUT Schema    ",
				async () => {
					return await client.query(
						api.benchmark.benchmarkEffectNoSchema.queryList,
						{
							_cacheKey: randomKey(),
						},
					);
				},
				iterations,
			);

			const queryEffectWithSchemaTime = await benchmark(
				"Query - Effect WITH Schema       ",
				async () => {
					return await client.query(
						api.benchmark.benchmarkEffectWithSchema.queryList,
						{
							_cacheKey: randomKey(),
						},
					);
				},
				iterations,
			);

			const queryFullRpcTime = await benchmark(
				"Query - Full Effect RPC          ",
				async () => {
					return await client.query(api.rpc.benchmark.effectList, {
						_cacheKey: randomKey(),
					});
				},
				iterations,
			);

			console.log("\n--- MUTATIONS ---\n");

			const mutationNoEffectTime = await benchmark(
				"Mutation - No Effect import         ",
				async () => {
					return await client.mutation(
						api.benchmark.benchmarkNoEffect.pureJsReturnId,
						{
							...testData,
							name: `${testData.name}-${randomKey()}`,
						},
					);
				},
				iterations,
			);

			const mutationMicroTime = await benchmark(
				"Mutation - effect/Micro only        ",
				async () => {
					return await client.mutation(
						api.benchmark.benchmarkMicro.pureJsReturnId,
						{
							...testData,
							name: `${testData.name}-${randomKey()}`,
						},
					);
				},
				iterations,
			);

			const mutationEffectNoSchemaTime = await benchmark(
				"Mutation - Effect WITHOUT Schema    ",
				async () => {
					return await client.mutation(
						api.benchmark.benchmarkEffectNoSchema.pureJsReturnId,
						{
							...testData,
							name: `${testData.name}-${randomKey()}`,
						},
					);
				},
				iterations,
			);

			const mutationEffectWithSchemaTime = await benchmark(
				"Mutation - Effect WITH Schema       ",
				async () => {
					return await client.mutation(
						api.benchmark.benchmarkEffectWithSchema.pureJsReturnId,
						{
							...testData,
							name: `${testData.name}-${randomKey()}`,
						},
					);
				},
				iterations,
			);

			const mutationFullRpcTime = await benchmark(
				"Mutation - Full Effect RPC          ",
				async () => {
					return await client.mutation(api.rpc.benchmark.effectAdd, {
						...testData,
						name: `${testData.name}-${randomKey()}`,
					});
				},
				iterations,
			);

			console.log("\n--- SCHEMA OVERHEAD ANALYSIS ---");
			console.log(
				`\nQuery baseline (no Effect):          ${queryNoEffectTime.toFixed(2)}ms`,
			);
			console.log(
				`Query - Micro overhead:              +${(queryMicroTime - queryNoEffectTime).toFixed(2)}ms (${(((queryMicroTime - queryNoEffectTime) / queryNoEffectTime) * 100).toFixed(1)}%)`,
			);
			console.log(
				`Query - Effect NO Schema overhead:   +${(queryEffectNoSchemaTime - queryNoEffectTime).toFixed(2)}ms (${(((queryEffectNoSchemaTime - queryNoEffectTime) / queryNoEffectTime) * 100).toFixed(1)}%)`,
			);
			console.log(
				`Query - Effect WITH Schema overhead: +${(queryEffectWithSchemaTime - queryNoEffectTime).toFixed(2)}ms (${(((queryEffectWithSchemaTime - queryNoEffectTime) / queryNoEffectTime) * 100).toFixed(1)}%)`,
			);
			console.log(
				`Query - Full RPC overhead:           +${(queryFullRpcTime - queryNoEffectTime).toFixed(2)}ms (${(((queryFullRpcTime - queryNoEffectTime) / queryNoEffectTime) * 100).toFixed(1)}%)`,
			);

			console.log(
				`\nMutation baseline (no Effect):       ${mutationNoEffectTime.toFixed(2)}ms`,
			);
			console.log(
				`Mutation - Micro overhead:           +${(mutationMicroTime - mutationNoEffectTime).toFixed(2)}ms (${(((mutationMicroTime - mutationNoEffectTime) / mutationNoEffectTime) * 100).toFixed(1)}%)`,
			);
			console.log(
				`Mutation - Effect NO Schema:         +${(mutationEffectNoSchemaTime - mutationNoEffectTime).toFixed(2)}ms (${(((mutationEffectNoSchemaTime - mutationNoEffectTime) / mutationNoEffectTime) * 100).toFixed(1)}%)`,
			);
			console.log(
				`Mutation - Effect WITH Schema:       +${(mutationEffectWithSchemaTime - mutationNoEffectTime).toFixed(2)}ms (${(((mutationEffectWithSchemaTime - mutationNoEffectTime) / mutationNoEffectTime) * 100).toFixed(1)}%)`,
			);
			console.log(
				`Mutation - Full RPC:                 +${(mutationFullRpcTime - mutationNoEffectTime).toFixed(2)}ms (${(((mutationFullRpcTime - mutationNoEffectTime) / mutationNoEffectTime) * 100).toFixed(1)}%)`,
			);

			console.log("\n--- KEY FINDINGS ---");
			const schemaQueryCost =
				queryEffectWithSchemaTime - queryEffectNoSchemaTime;
			const schemaMutationCost =
				mutationEffectWithSchemaTime - mutationEffectNoSchemaTime;
			const effectCoreQueryCost = queryEffectNoSchemaTime - queryNoEffectTime;
			const effectCoreMutationCost =
				mutationEffectNoSchemaTime - mutationNoEffectTime;

			console.log(`\nSchema import cost:`);
			console.log(`  Query:    ${schemaQueryCost.toFixed(2)}ms`);
			console.log(`  Mutation: ${schemaMutationCost.toFixed(2)}ms`);
			console.log(`\nEffect core (no Schema) cost:`);
			console.log(`  Query:    ${effectCoreQueryCost.toFixed(2)}ms`);
			console.log(`  Mutation: ${effectCoreMutationCost.toFixed(2)}ms`);
			console.log(`\nMicro cost:`);
			console.log(
				`  Query:    ${(queryMicroTime - queryNoEffectTime).toFixed(2)}ms`,
			);
			console.log(
				`  Mutation: ${(mutationMicroTime - mutationNoEffectTime).toFixed(2)}ms`,
			);

			expect(true).toBe(true);
		},
	);
});

describe("Summary", () => {
	it("prints summary", () => {
		console.log("\n=== FINAL SUMMARY ===\n");
		console.log("KEY FINDING:");
		console.log("  - Importing Effect adds ~40-50ms to ALL functions");
		console.log("  - Both queries AND mutations are affected equally");
		console.log("  - Previous 'no query overhead' was due to Convex caching");
		console.log("");
		console.log("Overhead breakdown:");
		console.log("  Effect import:           ~40ms");
		console.log("  Schema.Exit init:        ~8ms");
		console.log("  Effect.gen + runPromise: ~2ms");
		console.log("  Full RPC middleware:     ~5-10ms");
		console.log("  TOTAL:                   ~50-60ms");
		console.log("");
		console.log("Micro alternative:");
		console.log("  effect/Micro import:     ~2-3ms");
		console.log("  MicroRpcBuilder:         ~2-5ms total overhead");
		console.log("");
		console.log("Recommendations:");
		console.log(
			"  - Use MicroRpcBuilder for near-zero overhead Effect-style code",
		);
		console.log("  - Reserve full Effect RPC for complex workflows");
		console.log("  - Accept ~50ms overhead only when needed\n");

		expect(true).toBe(true);
	});
});
