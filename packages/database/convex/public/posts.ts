import { Effect, Option, Schema } from "effect";
import { Id } from "@packages/confect/server";
import { ConfectQueryCtx, query } from "../confect";

const PostWithSystemFields = Schema.Struct({
	_id: Schema.String,
	_creationTime: Schema.Number,
	title: Schema.String,
	content: Schema.String,
	authorId: Schema.String,
	published: Schema.Boolean,
});

export const listPublished = query({
	args: Schema.Struct({}),
	returns: Schema.Array(PostWithSystemFields),
	handler: () =>
		Effect.gen(function* () {
			const ctx = yield* ConfectQueryCtx;
			const posts = yield* ctx.db
				.query("posts")
				.withIndex("by_published", (q) => q.eq("published", true))
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

export const getById = query({
	args: Schema.Struct({ id: Id.Id("posts") }),
	returns: Schema.NullOr(PostWithSystemFields),
	handler: (args) =>
		Effect.gen(function* () {
			const ctx = yield* ConfectQueryCtx;
			const post = yield* ctx.db.get(args.id);
			return Option.match(post, {
				onNone: () => null,
				onSome: (p) => ({
					_id: p._id,
					_creationTime: p._creationTime,
					title: p.title,
					content: p.content,
					authorId: p.authorId,
					published: p.published,
				}),
			});
		}),
});
