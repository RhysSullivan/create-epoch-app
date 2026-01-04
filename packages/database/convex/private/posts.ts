import { v } from "convex/values";
import {
	internalMutation,
	internalQuery,
	privateMutation,
	privateQuery,
} from "../client";

export const create = internalMutation({
	args: {
		title: v.string(),
		content: v.string(),
		authorId: v.string(),
		published: v.boolean(),
	},
	returns: v.id("posts"),
	handler: async (ctx, args) => {
		return await ctx.db.insert("posts", args);
	},
});

export const update = internalMutation({
	args: {
		id: v.id("posts"),
		title: v.optional(v.string()),
		content: v.optional(v.string()),
		published: v.optional(v.boolean()),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const { id, ...updates } = args;
		await ctx.db.patch(id, updates);
		return null;
	},
});

export const deletePost = internalMutation({
	args: { id: v.id("posts") },
	returns: v.null(),
	handler: async (ctx, args) => {
		await ctx.db.delete(args.id);
		return null;
	},
});

export const getByAuthor = privateQuery({
	args: { authorId: v.string() },
	handler: async (ctx, args) => {
		return await ctx.db
			.query("posts")
			.withIndex("by_authorId", (q) => q.eq("authorId", args.authorId))
			.collect();
	},
});

export const getByAuthorInternal = internalQuery({
	args: { authorId: v.string() },
	returns: v.array(
		v.object({
			_id: v.id("posts"),
			_creationTime: v.number(),
			title: v.string(),
			content: v.string(),
			authorId: v.string(),
			published: v.boolean(),
		}),
	),
	handler: async (ctx, args) => {
		return await ctx.db
			.query("posts")
			.withIndex("by_authorId", (q) => q.eq("authorId", args.authorId))
			.collect();
	},
});

export const upsertPost = privateMutation({
	args: {
		title: v.string(),
		content: v.string(),
		authorId: v.string(),
		published: v.optional(v.boolean()),
	},
	handler: async (ctx, args) => {
		const id = await ctx.db.insert("posts", {
			...args,
			published: args.published ?? false,
		});
		return { id };
	},
});

export const publish = privateMutation({
	args: { id: v.id("posts") },
	handler: async (ctx, args) => {
		await ctx.db.patch(args.id, { published: true });
		return null;
	},
});
