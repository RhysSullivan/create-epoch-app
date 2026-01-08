import { createRpcFactory, makeRpcModule } from "@packages/confect/rpc";
import { createFunctions } from "@packages/confect/functions";
import {
	queryGeneric,
	mutationGeneric,
	type GenericQueryCtx,
	type GenericMutationCtx,
	type GenericDataModel,
} from "convex/server";
import { v } from "convex/values";
import { Effect, Schema } from "effect";
import { ConfectMutationCtx, ConfectQueryCtx, confectSchema } from "../confect";

const factory = createRpcFactory({ schema: confectSchema });
const confect = createFunctions(confectSchema);

const Entry = Schema.Struct({
	name: Schema.String,
	message: Schema.String,
});

export const rpcModule = makeRpcModule(confectSchema, {
	list: factory.query({ success: Schema.Array(Entry) }, () =>
		Effect.gen(function* () {
			const ctx = yield* ConfectQueryCtx;
			const entries = yield* ctx.db.query("guestbook").take(100);
			return entries.map((e) => ({
				name: e.name,
				message: e.message,
			}));
		}),
	),
	add: factory.mutation(
		{
			payload: Schema.Struct({ name: Schema.String, message: Schema.String }),
			success: Schema.String,
		},
		(args) =>
			Effect.gen(function* () {
				const ctx = yield* ConfectMutationCtx;
				const id = yield* ctx.db.insert("guestbook", {
					name: args.name,
					message: args.message,
				});
				return id;
			}),
	),
});

export const { list: rpcList, add: rpcAdd } = rpcModule.handlers;

export const confectList = confect.query({ returns: Schema.Array(Entry) }, () =>
	Effect.gen(function* () {
		const ctx = yield* ConfectQueryCtx;
		const entries = yield* ctx.db.query("guestbook").take(100);
		return entries.map((e) => ({
			name: e.name,
			message: e.message,
		}));
	}),
);

export const confectAdd = confect.mutation(
	{
		args: Schema.Struct({ name: Schema.String, message: Schema.String }),
		returns: Schema.String,
	},
	(args) =>
		Effect.gen(function* () {
			const ctx = yield* ConfectMutationCtx;
			const id = yield* ctx.db.insert("guestbook", {
				name: args.name,
				message: args.message,
			});
			return id;
		}),
);

export const vanillaList = queryGeneric({
	args: {},
	returns: v.array(
		v.object({
			name: v.string(),
			message: v.string(),
		}),
	),
	handler: async (ctx: GenericQueryCtx<GenericDataModel>) => {
		const entries = await ctx.db.query("guestbook").take(100);
		return entries.map((e) => ({
			name: String(e.name),
			message: String(e.message),
		}));
	},
});

export const vanillaAdd = mutationGeneric({
	args: { name: v.string(), message: v.string() },
	returns: v.string(),
	handler: async (
		ctx: GenericMutationCtx<GenericDataModel>,
		args: { name: string; message: string },
	) => {
		const id = await ctx.db.insert("guestbook", {
			name: args.name,
			message: args.message,
		});
		return id;
	},
});
