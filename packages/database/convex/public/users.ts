import { v } from "convex/values";
import { publicQuery } from "./custom_functions";

export const getByEmail = publicQuery({
	args: { email: v.string() },
	handler: async (ctx, args) => {
		return await ctx.db
			.query("users")
			.withIndex("by_email", (q) => q.eq("email", args.email))
			.unique();
	},
});

export const list = publicQuery({
	args: {},
	handler: async (ctx) => {
		return await ctx.db.query("users").collect();
	},
});
