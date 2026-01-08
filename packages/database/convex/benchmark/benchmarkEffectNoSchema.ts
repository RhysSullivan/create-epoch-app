import {
	type GenericMutationCtx,
	type GenericQueryCtx,
	mutationGeneric,
	queryGeneric,
} from "convex/server";
import { v } from "convex/values";
import { Context, Effect, Exit, pipe } from "effect";
import type { DataModel } from "../_generated/dataModel";

const QueryCtx = Context.GenericTag<GenericQueryCtx<DataModel>>("QueryCtx");

const MutationCtx =
	Context.GenericTag<GenericMutationCtx<DataModel>>("MutationCtx");

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
		const program = Effect.gen(function* () {
			const { db } = yield* QueryCtx;
			const entries = yield* Effect.promise(() =>
				db.query("guestbook").order("desc").take(10),
			);
			return entries.map((e) => ({
				_id: e._id as string,
				_creationTime: e._creationTime,
				name: e.name,
				message: e.message,
			}));
		}).pipe(Effect.provideService(QueryCtx, ctx));

		const exit = await Effect.runPromiseExit(program);
		if (Exit.isFailure(exit)) {
			throw exit.cause;
		}
		return exit.value;
	},
});

export const pureJsReturnId = mutationGeneric({
	args: {
		name: v.string(),
		message: v.string(),
	},
	returns: v.any(),
	handler: async (ctx, args: { name: string; message: string }) => {
		const program = Effect.gen(function* () {
			const { db } = yield* MutationCtx;
			const name = args.name.trim().slice(0, 50);
			const message = args.message.trim().slice(0, 500);
			const id = yield* Effect.promise(() =>
				db.insert("guestbook", { name, message }),
			);
			return id;
		}).pipe(Effect.provideService(MutationCtx, ctx));

		const exit = await Effect.runPromiseExit(program);
		if (Exit.isFailure(exit)) {
			throw exit.cause;
		}
		return exit.value;
	},
});

void pipe;
