import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import { Effect, Schema, pipe, Exit } from "effect";

export const queryList = queryGeneric({
	args: {
		_cacheKey: v.optional(v.string()),
	},
	returns: v.array(
		v.object({
			_id: v.string(),
			_creationTime: v.number(),
			name: v.string(),
			message: v.string(),
		}),
	),
	handler: async (ctx, _args) => {
		const entries = await ctx.db.query("guestbook").order("desc").take(10);
		return entries.map(
			(e: {
				_id: string;
				_creationTime: number;
				name: string;
				message: string;
			}) => ({
				_id: e._id,
				_creationTime: e._creationTime,
				name: e.name,
				message: e.message,
			}),
		);
	},
});

const exitSchema = Schema.Exit({
	success: Schema.String,
	failure: Schema.Never,
	defect: Schema.Defect,
});

export const pureJsReturnObject = mutationGeneric({
	args: {
		name: v.string(),
		message: v.string(),
	},
	returns: v.any(),
	handler: async (ctx, args: { name: string; message: string }) => {
		const name = args.name.trim().slice(0, 50);
		const message = args.message.trim().slice(0, 500);
		const id = await ctx.db.insert("guestbook", { name, message });
		return { _tag: "Success", value: id };
	},
});

export const pureJsReturnId = mutationGeneric({
	args: {
		name: v.string(),
		message: v.string(),
	},
	returns: v.any(),
	handler: async (ctx, args: { name: string; message: string }) => {
		const name = args.name.trim().slice(0, 50);
		const message = args.message.trim().slice(0, 500);
		const id = await ctx.db.insert("guestbook", { name, message });
		return id;
	},
});

export const minimalEffectNoSchema = mutationGeneric({
	args: {
		name: v.string(),
		message: v.string(),
	},
	returns: v.any(),
	handler: async (ctx, args: { name: string; message: string }) => {
		const name = args.name.trim().slice(0, 50);
		const message = args.message.trim().slice(0, 500);
		const id = await ctx.db.insert("guestbook", { name, message });
		return { _tag: "Success", value: id };
	},
});

export const minimalEffectRunPromise = mutationGeneric({
	args: {
		name: v.string(),
		message: v.string(),
	},
	returns: v.any(),
	handler: async (ctx, args: { name: string; message: string }) => {
		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const name = args.name.trim().slice(0, 50);
				const message = args.message.trim().slice(0, 500);
				const id = yield* Effect.promise(() =>
					ctx.db.insert("guestbook", { name, message }),
				);
				return id;
			}),
		);
		return { _tag: "Success", value: result };
	},
});

export const minimalEffectWithExit = mutationGeneric({
	args: {
		name: v.string(),
		message: v.string(),
	},
	returns: v.any(),
	handler: async (ctx, args: { name: string; message: string }) => {
		const exit = await pipe(
			Effect.gen(function* () {
				const name = args.name.trim().slice(0, 50);
				const message = args.message.trim().slice(0, 500);
				const id = yield* Effect.promise(() =>
					ctx.db.insert("guestbook", { name, message }),
				);
				return id;
			}),
			Effect.exit,
			Effect.runPromise,
		);
		if (Exit.isSuccess(exit)) {
			return { _tag: "Success", value: exit.value };
		}
		return { _tag: "Failure", cause: "error" };
	},
});

export const minimalEffectWithSchemaEncode = mutationGeneric({
	args: {
		name: v.string(),
		message: v.string(),
	},
	returns: v.any(),
	handler: async (ctx, args: { name: string; message: string }) => {
		return await pipe(
			Effect.gen(function* () {
				const name = args.name.trim().slice(0, 50);
				const message = args.message.trim().slice(0, 500);
				const id = yield* Effect.promise(() =>
					ctx.db.insert("guestbook", { name, message }),
				);
				return id;
			}),
			Effect.exit,
			Effect.flatMap((exit) => Schema.encode(exitSchema)(exit)),
			Effect.runPromise,
		);
	},
});

const PayloadSchema = Schema.Struct({
	name: Schema.String,
	message: Schema.String,
});

export const minimalEffectFullPipeline = mutationGeneric({
	args: {
		name: v.string(),
		message: v.string(),
	},
	returns: v.any(),
	handler: async (ctx, args: { name: string; message: string }) => {
		return await pipe(
			args,
			Schema.decode(PayloadSchema),
			Effect.orDie,
			Effect.flatMap((decoded) =>
				Effect.gen(function* () {
					const name = decoded.name.trim().slice(0, 50);
					const message = decoded.message.trim().slice(0, 500);
					const id = yield* Effect.promise(() =>
						ctx.db.insert("guestbook", { name, message }),
					);
					return id;
				}),
			),
			Effect.exit,
			Effect.flatMap((exit) => Schema.encode(exitSchema)(exit)),
			Effect.runPromise,
		);
	},
});
