import { Rpc } from "@effect/rpc";
import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";

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

void Rpc;
