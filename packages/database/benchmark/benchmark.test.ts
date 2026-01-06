import { describe, it, expect } from "vitest";
import { Effect, Schema, pipe, Exit } from "effect";

const mockDb = {
	entries: [
		{ _id: "1", _creationTime: 1000, name: "Alice", message: "Hello" },
		{ _id: "2", _creationTime: 2000, name: "Bob", message: "World" },
		{ _id: "3", _creationTime: 3000, name: "Charlie", message: "Test" },
	],
	query: (_table: string) => ({
		order: (_order: "asc" | "desc") => ({
			take: async (n: number) => mockDb.entries.slice(0, n),
		}),
	}),
	insert: async (_table: string, _data: { name: string; message: string }) => {
		return "new-id-123";
	},
};

async function benchmark(
	name: string,
	fn: () => Promise<unknown>,
	iterations: number = 10000,
): Promise<number> {
	for (let i = 0; i < 100; i++) {
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
		`${name}: ${avgMs.toFixed(4)}ms avg, ${opsPerSec.toLocaleString()} ops/sec (${iterations} iterations, ${totalMs.toFixed(2)}ms total)`,
	);

	return avgMs;
}

describe("Convex vs Effect Performance Benchmark", () => {
	it("Query: Normal Convex vs Effect approach", async () => {
		console.log("\n=== QUERY BENCHMARK ===\n");

		const normalTime = await benchmark("Normal Convex Query", async () => {
			const entries = await mockDb.query("guestbook").order("desc").take(50);
			return entries.map((e) => ({
				_id: e._id,
				_creationTime: e._creationTime,
				name: e.name,
				message: e.message,
			}));
		});

		const GuestbookEntry = Schema.Struct({
			_id: Schema.String,
			_creationTime: Schema.Number,
			name: Schema.String,
			message: Schema.String,
		});

		const exitSchema = Schema.Exit({
			success: Schema.Array(GuestbookEntry),
			failure: Schema.Never,
			defect: Schema.Defect,
		});

		const effectTime = await benchmark("Effect RPC Query   ", async () => {
			return pipe(
				Effect.gen(function* () {
					const entries = yield* Effect.promise(() =>
						mockDb.query("guestbook").order("desc").take(50),
					);
					return entries.map((e) => ({
						_id: e._id,
						_creationTime: e._creationTime,
						name: e.name,
						message: e.message,
					}));
				}),
				Effect.exit,
				Effect.flatMap((exit) => Schema.encode(exitSchema)(exit)),
				Effect.runPromise,
			);
		});

		const overhead = ((effectTime - normalTime) / normalTime) * 100;
		console.log(`\nEffect overhead: ${overhead.toFixed(2)}%`);
		console.log(`Effect is ${(effectTime / normalTime).toFixed(2)}x slower\n`);

		expect(effectTime).toBeGreaterThan(0);
	});

	it("Mutation: Normal Convex vs Effect approach", async () => {
		console.log("\n=== MUTATION BENCHMARK ===\n");

		const args = { name: "Test User", message: "Test message content" };

		const normalTime = await benchmark("Normal Convex Mutation", async () => {
			const name = args.name.trim().slice(0, 50);
			const message = args.message.trim().slice(0, 500);

			if (name.length === 0 || message.length === 0) {
				throw new Error("Name and message are required");
			}

			return await mockDb.insert("guestbook", { name, message });
		});

		const Payload = Schema.Struct({
			name: Schema.String,
			message: Schema.String,
		});

		const exitSchema = Schema.Exit({
			success: Schema.String,
			failure: Schema.Never,
			defect: Schema.Defect,
		});

		const effectTime = await benchmark("Effect RPC Mutation   ", async () => {
			return pipe(
				Schema.decode(Payload)(args),
				Effect.orDie,
				Effect.flatMap((decoded) => {
					const name = decoded.name.trim().slice(0, 50);
					const message = decoded.message.trim().slice(0, 500);

					if (name.length === 0 || message.length === 0) {
						return Effect.die(new Error("Name and message are required"));
					}

					return Effect.promise(() =>
						mockDb.insert("guestbook", { name, message }),
					);
				}),
				Effect.exit,
				Effect.flatMap((exit) => Schema.encode(exitSchema)(exit)),
				Effect.runPromise,
			);
		});

		const overhead = ((effectTime - normalTime) / normalTime) * 100;
		console.log(`\nEffect overhead: ${overhead.toFixed(2)}%`);
		console.log(`Effect is ${(effectTime / normalTime).toFixed(2)}x slower\n`);

		expect(effectTime).toBeGreaterThan(0);
	});

	it("Effect.gen overhead isolation", async () => {
		console.log("\n=== EFFECT.GEN OVERHEAD ===\n");

		const pureTime = await benchmark("Pure async/await     ", async () => {
			const entries = await mockDb.query("guestbook").order("desc").take(50);
			return entries.map((e) => ({
				_id: e._id,
				_creationTime: e._creationTime,
				name: e.name,
				message: e.message,
			}));
		});

		const effectTime = await benchmark("Effect.gen + runPromise", async () => {
			return Effect.runPromise(
				Effect.gen(function* () {
					const entries = yield* Effect.promise(() =>
						mockDb.query("guestbook").order("desc").take(50),
					);
					return entries.map((e) => ({
						_id: e._id,
						_creationTime: e._creationTime,
						name: e.name,
						message: e.message,
					}));
				}),
			);
		});

		const overhead = ((effectTime - pureTime) / pureTime) * 100;
		console.log(`\nEffect.gen overhead: ${overhead.toFixed(2)}%`);

		expect(effectTime).toBeGreaterThan(0);
	});

	it("Schema decode/encode overhead", async () => {
		console.log("\n=== SCHEMA DECODE/ENCODE OVERHEAD ===\n");

		const Payload = Schema.Struct({
			name: Schema.String,
			message: Schema.String,
		});

		const exitSchema = Schema.Exit({
			success: Schema.String,
			failure: Schema.Never,
			defect: Schema.Defect,
		});

		const testPayload = { name: "Test", message: "Hello" };
		const testExit = Exit.succeed("result-id");

		const rawTime = await benchmark("No schema (raw values)", async () => {
			return testPayload.name + testPayload.message;
		});

		const decodeTime = await benchmark("Schema.decode          ", async () => {
			return Effect.runPromise(Schema.decode(Payload)(testPayload));
		});

		const encodeTime = await benchmark("Schema.encode (Exit)   ", async () => {
			return Effect.runPromise(Schema.encode(exitSchema)(testExit));
		});

		console.log(
			`\nDecode overhead vs raw: ${(((decodeTime - rawTime) / rawTime) * 100).toFixed(2)}%`,
		);
		console.log(
			`Encode overhead vs raw: ${(((encodeTime - rawTime) / rawTime) * 100).toFixed(2)}%`,
		);

		expect(decodeTime).toBeGreaterThan(0);
	});

	it("Full pipeline breakdown", async () => {
		console.log("\n=== FULL PIPELINE BREAKDOWN ===\n");

		const exitSchema = Schema.Exit({
			success: Schema.String,
			failure: Schema.Never,
			defect: Schema.Defect,
		});

		const Payload = Schema.Struct({
			name: Schema.String,
			message: Schema.String,
		});

		const testPayload = { name: "Test User", message: "Test message content" };

		const t1 = await benchmark("1. Raw async operation", async () => {
			return mockDb.insert("guestbook", testPayload);
		});

		const t2 = await benchmark("2. + Effect.promise wrap", async () => {
			return Effect.runPromise(
				Effect.promise(() => mockDb.insert("guestbook", testPayload)),
			);
		});

		const t3 = await benchmark("3. + Effect.gen wrapper", async () => {
			return Effect.runPromise(
				Effect.gen(function* () {
					return yield* Effect.promise(() =>
						mockDb.insert("guestbook", testPayload),
					);
				}),
			);
		});

		const t4 = await benchmark("4. + Schema.decode", async () => {
			return Effect.runPromise(
				pipe(
					Schema.decode(Payload)(testPayload),
					Effect.orDie,
					Effect.flatMap(() =>
						Effect.promise(() => mockDb.insert("guestbook", testPayload)),
					),
				),
			);
		});

		const t5 = await benchmark("5. + Exit + Schema.encode", async () => {
			return Effect.runPromise(
				pipe(
					Schema.decode(Payload)(testPayload),
					Effect.orDie,
					Effect.flatMap(() =>
						Effect.promise(() => mockDb.insert("guestbook", testPayload)),
					),
					Effect.exit,
					Effect.flatMap((exit) => Schema.encode(exitSchema)(exit)),
				),
			);
		});

		console.log("\n--- Cumulative Cost Analysis ---");
		console.log(`Raw operation:        ${t1.toFixed(4)}ms (baseline)`);
		console.log(
			`Effect.promise:       +${(t2 - t1).toFixed(4)}ms (+${(((t2 - t1) / t1) * 100).toFixed(1)}%)`,
		);
		console.log(
			`Effect.gen:           +${(t3 - t2).toFixed(4)}ms (+${(((t3 - t2) / t1) * 100).toFixed(1)}%)`,
		);
		console.log(
			`Schema.decode:        +${(t4 - t3).toFixed(4)}ms (+${(((t4 - t3) / t1) * 100).toFixed(1)}%)`,
		);
		console.log(
			`Exit + Schema.encode: +${(t5 - t4).toFixed(4)}ms (+${(((t5 - t4) / t1) * 100).toFixed(1)}%)`,
		);
		console.log(
			`\nTotal overhead: ${(((t5 - t1) / t1) * 100).toFixed(1)}% slower than raw\n`,
		);

		expect(t5).toBeGreaterThan(0);
	});
});

describe("Summary", () => {
	it("prints summary", () => {
		console.log("\n=== SUMMARY ===\n");
		console.log(
			"This benchmark measures the OVERHEAD of the Effect RPC layer,",
		);
		console.log("NOT the actual Convex database performance.\n");
		console.log("The overhead includes:");
		console.log("  1. Effect.gen generator execution");
		console.log("  2. Effect.promise wrapper around async calls");
		console.log("  3. Schema.decode for input validation");
		console.log("  4. Exit wrapping for error handling");
		console.log("  5. Schema.encode for serializing the Exit result");
		console.log("");
		console.log("In production, the actual database I/O will dominate,");
		console.log("making this overhead relatively small (sub-millisecond).\n");

		expect(true).toBe(true);
	});
});
