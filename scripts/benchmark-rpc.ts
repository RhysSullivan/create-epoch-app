import { ConvexClient } from "convex/browser";
import { api } from "../packages/database/convex/_generated/api";

const CONVEX_URL =
	process.env.CONVEX_URL || "https://acoustic-bloodhound-425.convex.cloud";
const ITERATIONS = 100;

async function benchmark(name: string, fn: () => Promise<unknown>) {
	const times: number[] = [];

	for (let i = 0; i < 5; i++) {
		await fn();
	}

	for (let i = 0; i < ITERATIONS; i++) {
		const start = performance.now();
		await fn();
		times.push(performance.now() - start);
	}

	const avg = times.reduce((a, b) => a + b, 0) / times.length;
	const min = Math.min(...times);
	const max = Math.max(...times);
	const sorted = [...times].sort((a, b) => a - b);
	const p50 = sorted[Math.floor(times.length * 0.5)];
	const p95 = sorted[Math.floor(times.length * 0.95)];
	const p99 = sorted[Math.floor(times.length * 0.99)];

	console.log(`${name}:`);
	console.log(`  avg: ${avg.toFixed(2)}ms`);
	console.log(`  min: ${min.toFixed(2)}ms, max: ${max.toFixed(2)}ms`);
	console.log(
		`  p50: ${p50.toFixed(2)}ms, p95: ${p95.toFixed(2)}ms, p99: ${p99.toFixed(2)}ms`,
	);
	console.log();

	return { name, avg, min, max, p50, p95, p99 };
}

async function main() {
	console.log(`Connecting to Convex at ${CONVEX_URL}...`);
	const client = new ConvexClient(CONVEX_URL);

	console.log(`Running ${ITERATIONS} iterations for each benchmark...\n`);

	const results = [];

	results.push(
		await benchmark("Vanilla Convex Query (list)", () =>
			client.query(api.rpc.benchmark.vanillaList, {}),
		),
	);

	results.push(
		await benchmark("Confect Query (list)", () =>
			client.query(api.rpc.benchmark.confectList, {}),
		),
	);

	results.push(
		await benchmark("RPC Query (list)", () =>
			client.query(api.rpc.benchmark.rpcList, { payload: null }),
		),
	);

	console.log("=== SUMMARY ===\n");
	console.log("| Method | Avg (ms) | p50 (ms) | p95 (ms) | p99 (ms) |");
	console.log("|--------|----------|----------|----------|----------|");
	for (const r of results) {
		console.log(
			`| ${r.name.padEnd(30)} | ${r.avg.toFixed(2).padStart(8)} | ${r.p50.toFixed(2).padStart(8)} | ${r.p95.toFixed(2).padStart(8)} | ${r.p99.toFixed(2).padStart(8)} |`,
		);
	}

	await client.close();
}

main().catch(console.error);
