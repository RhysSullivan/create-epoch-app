import { Effect, Option, Schema } from "effect";
import { Id } from "@packages/confect/server";
import {
	ConfectMutationCtx,
	ConfectQueryCtx,
	internalMutation,
	internalQuery,
} from "../confect";

const PostWithSystemFields = Schema.Struct({
	_id: Schema.String,
	_creationTime: Schema.Number,
	title: Schema.String,
	content: Schema.String,
	authorId: Schema.String,
	published: Schema.Boolean,
});

export const create = internalMutation({
	args: Schema.Struct({
		title: Schema.String,
		content: Schema.String,
		authorId: Schema.String,
		published: Schema.Boolean,
	}),
	returns: Schema.String,
	handler: (args) =>
		Effect.gen(function* () {
			const ctx = yield* ConfectMutationCtx;
			const id = yield* ctx.db.insert("posts", args).pipe(Effect.orDie);
			return id;
		}),
});

export const update = internalMutation({
	args: Schema.Struct({
		id: Id.Id("posts"),
		title: Schema.optional(Schema.String),
		content: Schema.optional(Schema.String),
		published: Schema.optional(Schema.Boolean),
	}),
	returns: Schema.Null,
	handler: (args) =>
		Effect.gen(function* () {
			const ctx = yield* ConfectMutationCtx;
			const { id, ...updates } = args;
			yield* ctx.db.patch(id, updates).pipe(Effect.orDie);
			return null;
		}),
});

export const deletePost = internalMutation({
	args: Schema.Struct({ id: Id.Id("posts") }),
	returns: Schema.Null,
	handler: (args) =>
		Effect.gen(function* () {
			const ctx = yield* ConfectMutationCtx;
			yield* ctx.db.delete(args.id);
			return null;
		}),
});

export const getByAuthor = internalQuery({
	args: Schema.Struct({ authorId: Schema.String }),
	returns: Schema.Array(PostWithSystemFields),
	handler: (args) =>
		Effect.gen(function* () {
			const ctx = yield* ConfectQueryCtx;
			const posts = yield* ctx.db
				.query("posts")
				.withIndex("by_authorId", (q) => q.eq("authorId", args.authorId))
				.collect();
			return posts.map((p) => ({
				_id: p._id,
				_creationTime: p._creationTime,
				title: p.title,
				content: p.content,
				authorId: p.authorId,
				published: p.published,
			}));
		}),
});

export const publish = internalMutation({
	args: Schema.Struct({ id: Id.Id("posts") }),
	returns: Schema.Null,
	handler: (args) =>
		Effect.gen(function* () {
			const ctx = yield* ConfectMutationCtx;
			yield* ctx.db.patch(args.id, { published: true }).pipe(Effect.orDie);
			return null;
		}),
});
