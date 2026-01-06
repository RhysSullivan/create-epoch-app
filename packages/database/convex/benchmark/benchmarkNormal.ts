import { queryGeneric, mutationGeneric } from "convex/server";
import { v } from "convex/values";

export const normalList = queryGeneric({
	args: {},
	returns: v.array(
		v.object({
			_id: v.string(),
			_creationTime: v.number(),
			name: v.string(),
			message: v.string(),
		}),
	),
	handler: async (ctx) => {
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

export const normalAdd = mutationGeneric({
	args: {
		name: v.string(),
		message: v.string(),
	},
	returns: v.id("guestbook"),
	handler: async (ctx, args: { name: string; message: string }) => {
		const name = args.name.trim().slice(0, 50);
		const message = args.message.trim().slice(0, 500);
		return await ctx.db.insert("guestbook", { name, message });
	},
});
