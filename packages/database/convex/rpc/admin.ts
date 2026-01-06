import {
	createRpcFactory,
	makeRpcModule,
	RpcMiddleware,
} from "@packages/confect/rpc";
import { Effect, Schema } from "effect";
import type { Id } from "../_generated/dataModel";
import { ConfectMutationCtx, ConfectQueryCtx, confectSchema } from "../confect";

const ADMIN_KEY = process.env.ADMIN_SECRET_KEY ?? "admin-secret";

export class UnauthorizedError extends Schema.TaggedError<UnauthorizedError>()(
	"UnauthorizedError",
	{
		message: Schema.String,
	},
) {}

const AdminPayload = {
	privateAccessKey: Schema.String,
	adminKey: Schema.String,
};

class AdminMiddleware extends RpcMiddleware.Tag<AdminMiddleware>()(
	"AdminMiddleware",
	{
		failure: UnauthorizedError,
	},
) {}

const factory = createRpcFactory({
	schema: confectSchema,
	basePayload: AdminPayload,
	middlewares: [
		{
			tag: AdminMiddleware,
			impl: AdminMiddleware.of(({ payload }) => {
				const adminKey = (payload as { adminKey?: string })?.adminKey;
				if (adminKey !== ADMIN_KEY) {
					return Effect.fail(
						new UnauthorizedError({ message: "Invalid admin key" }),
					);
				}
				return Effect.void;
			}),
		},
	],
});

const UserSchema = Schema.Struct({
	_id: Schema.String,
	email: Schema.String,
	name: Schema.String,
	createdAt: Schema.Number,
});

const StatsSchema = Schema.Struct({
	totalUsers: Schema.Number,
	totalGuestbookEntries: Schema.Number,
	totalPosts: Schema.Number,
});

export const adminModule = makeRpcModule({
	getStats: factory.query({ success: StatsSchema }, () =>
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

	listUsers: factory.query(
		{
			payload: { limit: Schema.optional(Schema.Number) },
			success: Schema.Array(UserSchema),
		},
		(args) =>
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

	deleteGuestbookEntry: factory.mutation(
		{
			payload: { entryId: Schema.String },
			success: Schema.Void,
		},
		(args) =>
			Effect.gen(function* () {
				const ctx = yield* ConfectMutationCtx;

				yield* ctx.db
					.delete(args.entryId as Id<"guestbook">)
					.pipe(Effect.orDie);
			}),
	),
});

export const { getStats, listUsers, deleteGuestbookEntry } =
	adminModule.handlers;

export const AdminRpcs = adminModule.group;

export type AdminEndpoints = typeof adminModule._def.endpoints;
export type AdminModule = typeof adminModule;
