import { expect } from "vitest";
import { layer } from "@effect/vitest";
import { convexTest } from "@packages/convex-test";
import { Effect } from "effect";
import { makeTestLayer } from "@packages/confect/testing";
import { ConvexClient } from "@packages/confect/client";
import schema from "../schema";
import { api } from "../_generated/api";
import type { ExitEncoded } from "@packages/confect/rpc";

const modules = import.meta.glob("/convex/**/*.ts");

const TestLayer = makeTestLayer({ schema, modules, convexTest });

layer(TestLayer)("guestbook RPC module", (it) => {
	it.effect("should add and list entries", () =>
		Effect.gen(function* () {
			const client = yield* ConvexClient;

			const addResult = (yield* client.mutation(api.rpc.guestbook.add, {
				name: "Alice",
				message: "Hello world!",
			})) as ExitEncoded;

			expect(addResult._tag).toBe("Success");

			const listResult = (yield* client.query(
				api.rpc.guestbook.list,
				{},
			)) as ExitEncoded;

			expect(listResult._tag).toBe("Success");
			if (listResult._tag === "Success") {
				const entries = listResult.value as Array<{
					name: string;
					message: string;
				}>;
				expect(entries).toHaveLength(1);
				expect(entries[0]).toMatchObject({
					name: "Alice",
					message: "Hello world!",
				});
			}
		}),
	);

	it.effect("should return error for empty name", () =>
		Effect.gen(function* () {
			const client = yield* ConvexClient;

			const result = (yield* client.mutation(api.rpc.guestbook.add, {
				name: "   ",
				message: "Hello world!",
			})) as ExitEncoded;

			expect(result._tag).toBe("Failure");
			if (result._tag === "Failure") {
				const cause = result.cause as {
					_tag: string;
					error?: { _tag: string; field: string };
				};
				expect(cause._tag).toBe("Fail");
				expect(cause.error?._tag).toBe("EmptyFieldError");
				expect(cause.error?.field).toBe("name");
			}
		}),
	);

	it.effect("should return error for empty message", () =>
		Effect.gen(function* () {
			const client = yield* ConvexClient;

			const result = (yield* client.mutation(api.rpc.guestbook.add, {
				name: "Alice",
				message: "",
			})) as ExitEncoded;

			expect(result._tag).toBe("Failure");
		}),
	);

	it.effect("should allow adding multiple entries", () =>
		Effect.gen(function* () {
			const client = yield* ConvexClient;

			yield* client.mutation(api.rpc.guestbook.add, {
				name: "Bob",
				message: "Second entry",
			});

			const result = (yield* client.query(
				api.rpc.guestbook.list,
				{},
			)) as ExitEncoded;

			expect(result._tag).toBe("Success");
			if (result._tag === "Success") {
				const entries = result.value as Array<{
					name: string;
					message: string;
				}>;
				expect(entries.length).toBeGreaterThanOrEqual(1);
				expect(entries.some((e) => e.name === "Bob")).toBe(true);
			}
		}),
	);
});
