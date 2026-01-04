import { v } from "convex/values";
import {
	internalMutation,
	internalQuery,
	privateMutation,
	privateQuery,
} from "../client";

export const create = internalMutation({
	args: {
		name: v.string(),
		email: v.string(),
	},
	returns: v.id("users"),
	handler: async (ctx, args) => {
		return await ctx.db.insert("users", args);
	},
});

export const update = internalMutation({
	args: {
		id: v.id("users"),
		name: v.optional(v.string()),
		email: v.optional(v.string()),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const { id, ...updates } = args;
		await ctx.db.patch(id, updates);
		return null;
	},
});

export const deleteUser = internalMutation({
	args: { id: v.id("users") },
	returns: v.null(),
	handler: async (ctx, args) => {
		await ctx.db.delete(args.id);
		return null;
	},
});

export const getByEmail = privateQuery({
	args: { email: v.string() },
	handler: async (ctx, args) => {
		return await ctx.db
			.query("users")
			.withIndex("by_email", (q) => q.eq("email", args.email))
			.unique();
	},
});

export const getByEmailInternal = internalQuery({
	args: { email: v.string() },
	returns: v.union(
		v.object({
			_id: v.id("users"),
			_creationTime: v.number(),
			name: v.string(),
			email: v.string(),
		}),
		v.null(),
	),
	handler: async (ctx, args) => {
		return await ctx.db
			.query("users")
			.withIndex("by_email", (q) => q.eq("email", args.email))
			.unique();
	},
});

export const upsertUser = privateMutation({
	args: {
		name: v.string(),
		email: v.string(),
	},
	handler: async (ctx, args) => {
		const existing = await ctx.db
			.query("users")
			.withIndex("by_email", (q) => q.eq("email", args.email))
			.unique();

		if (existing) {
			await ctx.db.patch(existing._id, { name: args.name });
			return { isNew: false, id: existing._id };
		}
		const id = await ctx.db.insert("users", args);
		return { isNew: true, id };
	},
});
