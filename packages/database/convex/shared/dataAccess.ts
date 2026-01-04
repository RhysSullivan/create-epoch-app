import { getManyFrom, getOneFrom } from "convex-helpers/server/relationships";
import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";
import type { DataModel } from "../_generated/dataModel";

type BaseCtx = GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>;

function createRequestCache() {
	const cache = new Map<string, Promise<never>>();

	return {
		get<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
			const existing = cache.get(key);
			if (existing) {
				return existing;
			}
			const promise = fetcher();
			cache.set(key, promise as Promise<never>);
			return promise;
		},
	};
}

export function createDataAccessCache(ctx: BaseCtx) {
	const cache = createRequestCache();

	return {
		getUserByEmail: (email: string) =>
			cache.get(`user:${email}`, () =>
				getOneFrom(ctx.db, "users", "by_email", email),
			),

		getPostsByAuthor: (authorId: string) =>
			cache.get(`posts:${authorId}`, () =>
				getManyFrom(ctx.db, "posts", "by_authorId", authorId, "authorId"),
			),

		getPublishedPosts: () =>
			cache.get("publishedPosts", () =>
				ctx.db
					.query("posts")
					.withIndex("by_published", (q) => q.eq("published", true))
					.collect(),
			),
	};
}

export type DataAccessCache = ReturnType<typeof createDataAccessCache>;

export type QueryCtxWithCache = BaseCtx & { cache: DataAccessCache };
