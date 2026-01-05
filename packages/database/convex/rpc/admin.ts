import * as Admin from "@packages/api/admin";
import { UnauthorizedError } from "@packages/api/admin";
import { query, mutation } from "@packages/confect/convex";
import { Effect } from "effect";
import { confectSchema, ConfectMutationCtx, ConfectQueryCtx } from "../confect";
import type { Id } from "../_generated/dataModel";

const ADMIN_KEY = process.env.ADMIN_SECRET_KEY ?? "admin-secret";

const validateAdminKey = (adminKey: string) =>
	adminKey === ADMIN_KEY
		? Effect.void
		: Effect.fail(new UnauthorizedError({ message: "Invalid admin key" }));

export const getStats = query(confectSchema, Admin.getStats, (args) =>
	Effect.gen(function* () {
		yield* validateAdminKey(args.adminKey);
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
);

export const listUsers = query(confectSchema, Admin.listUsers, (args) =>
	Effect.gen(function* () {
		yield* validateAdminKey(args.adminKey);
		const ctx = yield* ConfectQueryCtx;

		const users = yield* ctx.db.query("users").take(args.limit ?? 50);

		return users.map((u) => ({
			_id: u._id,
			email: u.email,
			name: u.name,
			createdAt: u._creationTime,
		}));
	}),
);

export const deleteGuestbookEntry = mutation(
	confectSchema,
	Admin.deleteGuestbookEntry,
	(args) =>
		Effect.gen(function* () {
			yield* validateAdminKey(args.adminKey);
			const ctx = yield* ConfectMutationCtx;

			yield* ctx.db
				.delete(args.entryId as never as Id<"guestbook">)
				.pipe(Effect.orDie);
		}),
);
