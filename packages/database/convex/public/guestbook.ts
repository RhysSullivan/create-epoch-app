import { v } from "convex/values";
import { publicMutation, publicQuery } from "./custom_functions";

export const list = publicQuery({
	args: {},
	handler: async (ctx) => {
		return await ctx.db.query("guestbook").order("desc").take(50);
	},
});

export const add = publicMutation({
	args: {
		name: v.string(),
		message: v.string(),
	},
	handler: async (ctx, args) => {
		const name = args.name.trim().slice(0, 50);
		const message = args.message.trim().slice(0, 500);

		if (name.length === 0 || message.length === 0) {
			throw new Error("Name and message are required");
		}

		return await ctx.db.insert("guestbook", { name, message });
	},
});
