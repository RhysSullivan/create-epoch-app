import { AdminRpcs, UnauthorizedError } from "@packages/api/admin";
import { createConvexModule, RpcMiddleware } from "@packages/confect/rpc";
import { Effect } from "effect";
import { confectSchema, ConfectMutationCtx, ConfectQueryCtx } from "../confect";
import type { Id } from "../_generated/dataModel";

const ADMIN_KEY = process.env.ADMIN_SECRET_KEY ?? "admin-secret";

const withAdminAuth = RpcMiddleware.makeKeyAuth(
	"adminKey",
	(key) => key === ADMIN_KEY,
	() => new UnauthorizedError({ message: "Invalid admin key" }),
);

export const { getStats, listUsers, deleteGuestbookEntry } = createConvexModule(
	confectSchema,
	AdminRpcs,
	AdminRpcs.handlers({
		getStats: withAdminAuth(() =>
			Effect.gen(function* () {
				const ctx = yield* ConfectQueryCtx;

				const users = yield* ctx.db.query("users").collect();
				const guestbook = yield* ctx.db.query("guestbook").collect();
				const posts = yield* ctx.db.query("posts").collect();

				return {
					totalUsers: users.length,
					totalGuestbookEntries: guestbook.length,
					totalPosts: posts.length,
				};
			}),
		),

		listUsers: withAdminAuth((args) =>
			Effect.gen(function* () {
				const ctx = yield* ConfectQueryCtx;

				const users = yield* ctx.db.query("users").take(args.limit ?? 50);

				return users.map((u) => ({
					_id: u._id,
					email: u.email,
					name: u.name,
					createdAt: u._creationTime,
				}));
			}),
		),

		deleteGuestbookEntry: withAdminAuth((args) =>
			Effect.gen(function* () {
				const ctx = yield* ConfectMutationCtx;

				yield* ctx.db
					.delete(args.entryId as Id<"guestbook">)
					.pipe(Effect.orDie);
			}),
		),
	}),
);
