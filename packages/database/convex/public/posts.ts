import { v } from "convex/values";
import { publicQuery } from "./custom_functions";

export const listPublished = publicQuery({
	args: {},
	handler: async (ctx) => {
		return await ctx.db
			.query("posts")
			.withIndex("by_published", (q) => q.eq("published", true))
			.collect();
	},
});

export const getById = publicQuery({
	args: { id: v.id("posts") },
	handler: async (ctx, args) => {
		return await ctx.db.get(args.id);
	},
});
