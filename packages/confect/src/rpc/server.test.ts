import { describe, expect, it, vi } from "vitest";
import { Effect, Schema, Context } from "effect";
import { RpcMiddleware } from "@effect/rpc";
import {
	createRpcFactory,
	makeRpcModule,
	type ExitEncoded,
} from "./server";
import { defineSchema, defineTable } from "../schema";

const testSchema = defineSchema({
	items: defineTable(
		Schema.Struct({
			name: Schema.String,
			value: Schema.Number,
		}),
	),
});

const createMockCtx = () => ({
	db: {
		query: vi.fn(),
		get: vi.fn(),
		insert: vi.fn(),
		patch: vi.fn(),
		replace: vi.fn(),
		delete: vi.fn(),
		normalizeId: vi.fn(),
	},
	auth: {
		getUserIdentity: vi.fn().mockResolvedValue(null),
	},
	runQuery: vi.fn(),
	runMutation: vi.fn(),
	runAction: vi.fn(),
	scheduler: {
		runAfter: vi.fn(),
		runAt: vi.fn(),
	},
});

type ConvexHandlerInternal = (ctx: unknown, args: unknown) => Promise<ExitEncoded>;

const getHandler = (handler: unknown): ConvexHandlerInternal => {
	const h = handler as { _handler: (ctx: unknown, args: unknown) => Promise<ExitEncoded> };
	return h._handler;
};

describe("RPC Server", () => {
	describe("createRpcFactory", () => {
		it("creates a factory with query, mutation, and action methods", () => {
			const factory = createRpcFactory({ schema: testSchema });

			expect(factory.query).toBeDefined();
			expect(factory.mutation).toBeDefined();
			expect(factory.action).toBeDefined();
			expect(factory.internalQuery).toBeDefined();
			expect(factory.internalMutation).toBeDefined();
			expect(factory.internalAction).toBeDefined();
		});

		describe("query endpoint", () => {
			it("creates a query endpoint with success schema", () => {
				const factory = createRpcFactory({ schema: testSchema });

				const endpoint = factory.query({ success: Schema.String }, () =>
					Effect.succeed("hello"),
				);

				expect(endpoint.__unbuilt).toBe(true);
				expect(endpoint.kind).toBe("query");
				expect(endpoint.successSchema).toBe(Schema.String);
			});

			it("creates a query endpoint with payload", () => {
				const factory = createRpcFactory({ schema: testSchema });

				const endpoint = factory.query(
					{
						payload: { name: Schema.String },
						success: Schema.String,
					},
					(args) => Effect.succeed(`Hello, ${args.name}`),
				);

				expect(endpoint.__unbuilt).toBe(true);
				expect(endpoint.payloadFields).toHaveProperty("name");
			});

			it("creates a query endpoint with error schema", () => {
				class CustomError extends Schema.TaggedError<CustomError>()(
					"CustomError",
					{ message: Schema.String },
				) {}

				const factory = createRpcFactory({ schema: testSchema });

				const endpoint = factory.query(
					{
						success: Schema.String,
						error: CustomError,
					},
					() => Effect.fail(new CustomError({ message: "test" })),
				);

				expect(endpoint.__unbuilt).toBe(true);
				expect(endpoint.errorSchema).toBe(CustomError);
			});
		});

		describe("mutation endpoint", () => {
			it("creates a mutation endpoint", () => {
				const factory = createRpcFactory({ schema: testSchema });

				const endpoint = factory.mutation(
					{
						payload: { value: Schema.Number },
						success: Schema.Boolean,
					},
					(args) => Effect.succeed(args.value > 0),
				);

				expect(endpoint.__unbuilt).toBe(true);
				expect(endpoint.kind).toBe("mutation");
			});
		});

		describe("action endpoint", () => {
			it("creates an action endpoint", () => {
				const factory = createRpcFactory({ schema: testSchema });

				const endpoint = factory.action(
					{ success: Schema.Void },
					() => Effect.void,
				);

				expect(endpoint.__unbuilt).toBe(true);
				expect(endpoint.kind).toBe("action");
			});
		});

		describe("internal endpoints", () => {
			it("creates internal query endpoint", () => {
				const factory = createRpcFactory({ schema: testSchema });

				const endpoint = factory.internalQuery(
					{ success: Schema.Number },
					() => Effect.succeed(42),
				);

				expect(endpoint.__unbuilt).toBe(true);
				expect(endpoint.kind).toBe("internalQuery");
			});

			it("creates internal mutation endpoint", () => {
				const factory = createRpcFactory({ schema: testSchema });

				const endpoint = factory.internalMutation(
					{ success: Schema.Void },
					() => Effect.void,
				);

				expect(endpoint.__unbuilt).toBe(true);
				expect(endpoint.kind).toBe("internalMutation");
			});

			it("creates internal action endpoint", () => {
				const factory = createRpcFactory({ schema: testSchema });

				const endpoint = factory.internalAction(
					{ success: Schema.String },
					() => Effect.succeed("internal"),
				);

				expect(endpoint.__unbuilt).toBe(true);
				expect(endpoint.kind).toBe("internalAction");
			});
		});
	});

	describe("makeRpcModule", () => {
		it("builds endpoints with correct tags", () => {
			const factory = createRpcFactory({ schema: testSchema });

			const module = makeRpcModule({
				getItems: factory.query({ success: Schema.Array(Schema.String) }, () =>
					Effect.succeed([]),
				),
				addItem: factory.mutation(
					{ payload: { name: Schema.String }, success: Schema.String },
					(args) => Effect.succeed(args.name),
				),
			});

			expect(module.getItems._tag).toBe("getItems");
			expect(module.addItem._tag).toBe("addItem");
		});

		it("provides handlers for each endpoint", () => {
			const factory = createRpcFactory({ schema: testSchema });

			const module = makeRpcModule({
				echo: factory.query(
					{ payload: { message: Schema.String }, success: Schema.String },
					(args) => Effect.succeed(args.message),
				),
			});

			expect(module.handlers.echo).toBeDefined();
		});

		it("provides rpcs for each endpoint", () => {
			const factory = createRpcFactory({ schema: testSchema });

			const module = makeRpcModule({
				myQuery: factory.query({ success: Schema.Void }, () => Effect.void),
			});

			expect(module.rpcs.myQuery).toBeDefined();
		});

		it("provides a group for all rpcs", () => {
			const factory = createRpcFactory({ schema: testSchema });

			const module = makeRpcModule({
				first: factory.query({ success: Schema.String }, () =>
					Effect.succeed("1"),
				),
				second: factory.query({ success: Schema.Number }, () =>
					Effect.succeed(2),
				),
			});

			expect(module.group).toBeDefined();
		});
	});

	describe("basePayload", () => {
		it("merges base payload with endpoint payload", () => {
			const factory = createRpcFactory({
				schema: testSchema,
				basePayload: {
					tenantId: Schema.String,
				},
			});

			const endpoint = factory.query(
				{
					payload: { itemId: Schema.String },
					success: Schema.Void,
				},
				(args) => {
					expect(args.tenantId).toBeDefined();
					expect(args.itemId).toBeDefined();
					return Effect.void;
				},
			);

			expect(endpoint.payloadFields).toHaveProperty("tenantId");
			expect(endpoint.payloadFields).toHaveProperty("itemId");
		});
	});

	describe("ExitEncoded format", () => {
		const factory = createRpcFactory({ schema: testSchema });

		it("encodes success correctly", async () => {
			const module = makeRpcModule({
				test: factory.query({ success: Schema.String }, () =>
					Effect.succeed("hello"),
				),
			});

			const ctx = createMockCtx();
			const handler = getHandler(module.handlers.test);
			const result = await handler(ctx, {});

			expect(result._tag).toBe("Success");
			expect(result.value).toBe("hello");
		});

		it("encodes failure correctly", async () => {
			class TestError extends Schema.TaggedError<TestError>()("TestError", {
				code: Schema.Number,
			}) {}

			const module = makeRpcModule({
				test: factory.query(
					{ success: Schema.String, error: TestError },
					() => Effect.fail(new TestError({ code: 500 })),
				),
			});

			const ctx = createMockCtx();
			const handler = getHandler(module.handlers.test);
			const result = await handler(ctx, {});

			expect(result._tag).toBe("Failure");
			expect(result.cause).toEqual({
				_tag: "Fail",
				error: { _tag: "TestError", code: 500 },
			});
		});

		it("encodes defects (thrown errors) correctly", async () => {
			const module = makeRpcModule({
				test: factory.query({ success: Schema.Void }, () =>
					Effect.die(new Error("unexpected error")),
				),
			});

			const ctx = createMockCtx();
			const handler = getHandler(module.handlers.test);
			const result = await handler(ctx, {});

			expect(result._tag).toBe("Failure");
			expect(result.cause).toMatchObject({
				_tag: "Die",
				defect: {
					_tag: "Error",
					message: "unexpected error",
				},
			});
		});

		it("handles payload decode errors as defects", async () => {
			const module = makeRpcModule({
				test: factory.query(
					{ payload: { num: Schema.Number }, success: Schema.Void },
					() => Effect.void,
				),
			});

			const ctx = createMockCtx();
			const handler = getHandler(module.handlers.test);
			const result = await handler(ctx, { num: "not a number" });

			expect(result._tag).toBe("Failure");
			expect(result.cause).toHaveProperty("_tag", "Die");
		});
	});

	describe("complex success/error schemas", () => {
		const factory = createRpcFactory({ schema: testSchema });

		it("handles array success schema", async () => {
			const ItemSchema = Schema.Struct({
				id: Schema.String,
				name: Schema.String,
			});

			const module = makeRpcModule({
				getItems: factory.query({ success: Schema.Array(ItemSchema) }, () =>
					Effect.succeed([
						{ id: "1", name: "Item 1" },
						{ id: "2", name: "Item 2" },
					]),
				),
			});

			const ctx = createMockCtx();
			const handler = getHandler(module.handlers.getItems);
			const result = await handler(ctx, {});

			expect(result._tag).toBe("Success");
			expect(result.value).toEqual([
				{ id: "1", name: "Item 1" },
				{ id: "2", name: "Item 2" },
			]);
		});

		it("handles union error schema", async () => {
			class NotFoundError extends Schema.TaggedError<NotFoundError>()(
				"NotFoundError",
				{ id: Schema.String },
			) {}

			class ForbiddenError extends Schema.TaggedError<ForbiddenError>()(
				"ForbiddenError",
				{},
			) {}

			const ErrorSchema = Schema.Union(NotFoundError, ForbiddenError);

			const module = makeRpcModule({
				getItem: factory.query(
					{
						payload: { id: Schema.String },
						success: Schema.Void,
						error: ErrorSchema,
					},
					(args) => Effect.fail(new NotFoundError({ id: args.id })),
				),
			});

			const ctx = createMockCtx();
			const handler = getHandler(module.handlers.getItem);
			const result = await handler(ctx, { id: "123" });

			expect(result._tag).toBe("Failure");
			expect(result.cause).toEqual({
				_tag: "Fail",
				error: { _tag: "NotFoundError", id: "123" },
			});
		});

		it("handles optional fields in payload", async () => {
			const module = makeRpcModule({
				search: factory.query(
					{
						payload: {
							query: Schema.String,
							limit: Schema.optional(Schema.Number),
						},
						success: Schema.Array(Schema.String),
					},
					(args) => {
						const limit = args.limit ?? 10;
						return Effect.succeed(
							Array(limit)
								.fill(null)
								.map((_, i) => `${args.query}-${i}`),
						);
					},
				),
			});

			const ctx = createMockCtx();
			const handler = getHandler(module.handlers.search);

			const resultWithLimit = await handler(ctx, {
				query: "test",
				limit: 3,
			});
			expect(resultWithLimit._tag).toBe("Success");
			expect((resultWithLimit.value as string[]).length).toBe(3);

			const resultWithoutLimit = await handler(ctx, {
				query: "test",
			});
			expect(resultWithoutLimit._tag).toBe("Success");
			expect((resultWithoutLimit.value as string[]).length).toBe(10);
		});
	});

	describe("middleware", () => {
		class CurrentUser extends Context.Tag("CurrentUser")<
			CurrentUser,
			{ id: string; name: string }
		>() {}

		class AuthMiddleware extends RpcMiddleware.Tag<AuthMiddleware>()(
			"AuthMiddleware",
			{
				provides: CurrentUser,
			},
		) {}

		it("provides service from middleware", async () => {
			const factory = createRpcFactory({
				schema: testSchema,
				middlewares: [
					{
						tag: AuthMiddleware,
						impl: AuthMiddleware.of(() =>
							Effect.succeed({ id: "user-123", name: "Test User" }),
						),
					},
				],
			});

			const module = makeRpcModule({
				whoami: factory.query({ success: Schema.String }, () =>
					Effect.gen(function* () {
						const user = yield* CurrentUser;
						return `Hello, ${user.name}!`;
					}),
				),
			});

			const ctx = createMockCtx();
			const handler = getHandler(module.handlers.whoami);
			const result = await handler(ctx, {});

			expect(result._tag).toBe("Success");
			expect(result.value).toBe("Hello, Test User!");
		});

		it("middleware receives payload", async () => {
			let receivedPayload: unknown = null;

			const factory = createRpcFactory({
				schema: testSchema,
				middlewares: [
					{
						tag: AuthMiddleware,
						impl: AuthMiddleware.of((options) => {
							receivedPayload = options.payload;
							return Effect.succeed({ id: "user-123", name: "Test User" });
						}),
					},
				],
			});

			const module = makeRpcModule({
				test: factory.query(
					{ payload: { itemId: Schema.String }, success: Schema.Void },
					() => Effect.void,
				),
			});

			const ctx = createMockCtx();
			const handler = getHandler(module.handlers.test);
			await handler(ctx, { itemId: "item-456" });

			expect(receivedPayload).toEqual({ itemId: "item-456" });
		});

		it("middleware failure is encoded correctly", async () => {
			class AuthError extends Schema.TaggedError<AuthError>()("AuthError", {
				reason: Schema.String,
			}) {}

			class FailingAuthMiddleware extends RpcMiddleware.Tag<FailingAuthMiddleware>()(
				"FailingAuthMiddleware",
				{
					provides: CurrentUser,
					failure: AuthError,
				},
			) {}

			const factory = createRpcFactory({
				schema: testSchema,
				middlewares: [
					{
						tag: FailingAuthMiddleware,
						impl: FailingAuthMiddleware.of(() =>
							Effect.fail(new AuthError({ reason: "Invalid token" })),
						),
					},
				],
			});

			const module = makeRpcModule({
				protected: factory.query({ success: Schema.String }, () =>
					Effect.succeed("secret"),
				),
			});

			const ctx = createMockCtx();
			const handler = getHandler(module.handlers.protected);
			const result = await handler(ctx, {});

			expect(result._tag).toBe("Failure");
			expect(result.cause).toMatchObject({
				_tag: "Fail",
				error: { _tag: "AuthError", reason: "Invalid token" },
			});
		});

		it("multiple middlewares are applied in order", async () => {
			const executionOrder: string[] = [];

			class Logger extends Context.Tag("Logger")<Logger, { log: (msg: string) => void }>() {}

			class LoggerMiddleware extends RpcMiddleware.Tag<LoggerMiddleware>()(
				"LoggerMiddleware",
				{
					provides: Logger,
				},
			) {}

			const factory = createRpcFactory({
				schema: testSchema,
				middlewares: [
					{
						tag: AuthMiddleware,
						impl: AuthMiddleware.of(() => {
							executionOrder.push("auth");
							return Effect.succeed({ id: "user-123", name: "Test User" });
						}),
					},
					{
						tag: LoggerMiddleware,
						impl: LoggerMiddleware.of(() => {
							executionOrder.push("logger");
							return Effect.succeed({ log: (msg: string) => executionOrder.push(`log:${msg}`) });
						}),
					},
				],
			});

			const module = makeRpcModule({
				test: factory.query({ success: Schema.String }, () =>
					Effect.gen(function* () {
						const user = yield* CurrentUser;
						const logger = yield* Logger;
						logger.log("accessed");
						return user.name;
					}),
				),
			});

			const ctx = createMockCtx();
			const handler = getHandler(module.handlers.test);
			const result = await handler(ctx, {});

			expect(result._tag).toBe("Success");
			expect(result.value).toBe("Test User");
			expect(executionOrder).toContain("auth");
			expect(executionOrder).toContain("logger");
			expect(executionOrder).toContain("log:accessed");
		});

		it("works without any middleware", async () => {
			const factory = createRpcFactory({
				schema: testSchema,
				middlewares: [],
			});

			const module = makeRpcModule({
				simple: factory.query({ success: Schema.Number }, () =>
					Effect.succeed(42),
				),
			});

			const ctx = createMockCtx();
			const handler = getHandler(module.handlers.simple);
			const result = await handler(ctx, {});

			expect(result._tag).toBe("Success");
			expect(result.value).toBe(42);
		});
	});

	describe("security and error encoding", () => {
		const factory = createRpcFactory({ schema: testSchema });

		it("does not expose error stack traces in defects", async () => {
			const module = makeRpcModule({
				test: factory.query({ success: Schema.Void }, () => {
					const error = new Error("Internal error with sensitive info");
					error.stack = "Error: Internal error\n  at secret/path/to/file.ts:42:13";
					return Effect.die(error);
				}),
			});

			const ctx = createMockCtx();
			const handler = getHandler(module.handlers.test);
			const result = await handler(ctx, {});

			expect(result._tag).toBe("Failure");
			expect(result.cause).toMatchObject({
				_tag: "Die",
				defect: {
					_tag: "Error",
					message: "Internal error with sensitive info",
				},
			});
			const causeStr = JSON.stringify(result.cause);
			expect(causeStr).not.toContain("stack");
			expect(causeStr).not.toContain("secret/path");
		});

		it("serializes non-Error defects safely", async () => {
			const module = makeRpcModule({
				test: factory.query({ success: Schema.Void }, () =>
					Effect.die("raw string error"),
				),
			});

			const ctx = createMockCtx();
			const handler = getHandler(module.handlers.test);
			const result = await handler(ctx, {});

			expect(result._tag).toBe("Failure");
			expect(result.cause).toMatchObject({
				_tag: "Die",
				defect: {
					_tag: "UnknownDefect",
					message: "raw string error",
				},
			});
		});

		it("serializes object defects with _tag", async () => {
			const module = makeRpcModule({
				test: factory.query({ success: Schema.Void }, () =>
					Effect.die({ _tag: "CustomDefect", code: 500, details: "some details" }),
				),
			});

			const ctx = createMockCtx();
			const handler = getHandler(module.handlers.test);
			const result = await handler(ctx, {});

			expect(result._tag).toBe("Failure");
			expect(result.cause).toMatchObject({
				_tag: "Die",
				defect: {
					_tag: "CustomDefect",
				},
			});
		});

		it("encodes empty cause when effect exits with no error or defect", async () => {
			const module = makeRpcModule({
				test: factory.query({ success: Schema.Void }, () =>
					Effect.failCause({ _tag: "Empty" } as never),
				),
			});

			const ctx = createMockCtx();
			const handler = getHandler(module.handlers.test);
			const result = await handler(ctx, {});

			expect(result._tag).toBe("Failure");
			expect(result.cause).toMatchObject({
				_tag: "Empty",
			});
		});

		it("encodes tagged errors with their schema", async () => {
			class ValidationError extends Schema.TaggedError<ValidationError>()(
				"ValidationError",
				{
					field: Schema.String,
					message: Schema.String,
				},
			) {}

			const module = makeRpcModule({
				test: factory.query(
					{ success: Schema.Void, error: ValidationError },
					() => Effect.fail(new ValidationError({ field: "email", message: "Invalid format" })),
				),
			});

			const ctx = createMockCtx();
			const handler = getHandler(module.handlers.test);
			const result = await handler(ctx, {});

			expect(result._tag).toBe("Failure");
			expect(result.cause).toMatchObject({
				_tag: "Fail",
				error: {
					_tag: "ValidationError",
					field: "email",
					message: "Invalid format",
				},
			});
		});

		it("handles thrown sync exceptions as defects", async () => {
			const module = makeRpcModule({
				test: factory.query({ success: Schema.Void }, () =>
					Effect.sync(() => {
						throw new Error("Sync throw");
					}),
				),
			});

			const ctx = createMockCtx();
			const handler = getHandler(module.handlers.test);
			const result = await handler(ctx, {});

			expect(result._tag).toBe("Failure");
			expect(result.cause).toMatchObject({
				_tag: "Die",
				defect: {
					_tag: "Error",
					message: "Sync throw",
				},
			});
		});

		it("handles promise rejections as defects", async () => {
			const module = makeRpcModule({
				test: factory.query({ success: Schema.Void }, () =>
					Effect.promise(() => Promise.reject(new Error("Promise rejection"))),
				),
			});

			const ctx = createMockCtx();
			const handler = getHandler(module.handlers.test);
			const result = await handler(ctx, {});

			expect(result._tag).toBe("Failure");
			expect(result.cause).toMatchObject({
				_tag: "Die",
				defect: {
					_tag: "Error",
					message: "Promise rejection",
				},
			});
		});

		it("encodes nested error structures properly", async () => {
			class OuterError extends Schema.TaggedError<OuterError>()("OuterError", {
				inner: Schema.Struct({
					code: Schema.Number,
					details: Schema.Array(Schema.String),
				}),
			}) {}

			const module = makeRpcModule({
				test: factory.query(
					{ success: Schema.Void, error: OuterError },
					() =>
						Effect.fail(
							new OuterError({
								inner: {
									code: 422,
									details: ["Field 1 invalid", "Field 2 missing"],
								},
							}),
						),
				),
			});

			const ctx = createMockCtx();
			const handler = getHandler(module.handlers.test);
			const result = await handler(ctx, {});

			expect(result._tag).toBe("Failure");
			expect(result.cause).toMatchObject({
				_tag: "Fail",
				error: {
					_tag: "OuterError",
					inner: {
						code: 422,
						details: ["Field 1 invalid", "Field 2 missing"],
					},
				},
			});
		});
	});
});
