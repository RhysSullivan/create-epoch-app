import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";
import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import * as Context from "effect/Context";
import * as Micro from "effect/Micro";

type RawQueryCtx = GenericQueryCtx<import("./_generated/dataModel").DataModel>;
type RawMutationCtx = GenericMutationCtx<
	import("./_generated/dataModel").DataModel
>;

class MicroQueryCtx extends Context.Tag("MicroQueryCtx")<
	MicroQueryCtx,
	RawQueryCtx
>() {}

class MicroMutationCtx extends Context.Tag("MicroMutationCtx")<
	MicroMutationCtx,
	RawMutationCtx
>() {}

type MicroExit<A, E> =
	| { readonly _tag: "Success"; readonly value: A }
	| { readonly _tag: "Failure"; readonly error: E }
	| { readonly _tag: "Die"; readonly defect: unknown };

const encodeMicroExit = <A, E>(
	exit: Micro.MicroExit<A, E>,
): MicroExit<A, E> => {
	if (exit._tag === "Success") {
		return { _tag: "Success", value: exit.value };
	}
	const cause = exit.cause;
	if (cause._tag === "Fail") {
		return { _tag: "Failure", error: cause.error };
	}
	if (cause._tag === "Die") {
		return { _tag: "Die", defect: cause.defect };
	}
	return { _tag: "Die", defect: "Interrupted" };
};

const runMicroHandler = async <A, E>(
	effect: Micro.Micro<A, E, never>,
): Promise<MicroExit<A, E>> => {
	const exit = await Micro.runPromiseExit(effect);
	return encodeMicroExit(exit);
};

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

export const microRunPromise = mutationGeneric({
	args: {
		name: v.string(),
		message: v.string(),
	},
	returns: v.any(),
	handler: async (ctx, args: { name: string; message: string }) => {
		const result = await Micro.runPromise(
			Micro.gen(function* () {
				const name = args.name.trim().slice(0, 50);
				const message = args.message.trim().slice(0, 500);
				const id = yield* Micro.promise(() =>
					ctx.db.insert("guestbook", { name, message }),
				);
				return id;
			}),
		);
		return { _tag: "Success" as const, value: result };
	},
});

export const microWithContext = mutationGeneric({
	args: {
		name: v.string(),
		message: v.string(),
	},
	returns: v.any(),
	handler: async (ctx, args: { name: string; message: string }) => {
		const effect = Micro.gen(function* () {
			const mutationCtx = yield* Micro.service(MicroMutationCtx);
			const name = args.name.trim().slice(0, 50);
			const message = args.message.trim().slice(0, 500);
			const id = yield* Micro.promise(() =>
				mutationCtx.db.insert("guestbook", { name, message }),
			);
			return id;
		}).pipe(Micro.provideService(MicroMutationCtx, ctx));

		return await runMicroHandler(effect);
	},
});

export const microQueryWithContext = queryGeneric({
	args: {
		_cacheKey: v.optional(v.string()),
	},
	returns: v.any(),
	handler: async (ctx, _args) => {
		const effect = Micro.gen(function* () {
			const queryCtx = yield* Micro.service(MicroQueryCtx);
			const entries = yield* Micro.promise(() =>
				queryCtx.db.query("guestbook").order("desc").take(10),
			);
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
		}).pipe(Micro.provideService(MicroQueryCtx, ctx));

		return await runMicroHandler(effect);
	},
});

void Micro;
void Context;
