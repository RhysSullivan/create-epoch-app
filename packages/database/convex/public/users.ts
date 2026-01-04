import { Effect, Option, Schema } from "effect";
import { ConfectQueryCtx, query } from "../confect";

const UserWithSystemFields = Schema.Struct({
	_id: Schema.String,
	_creationTime: Schema.Number,
	name: Schema.String,
	email: Schema.String,
});

export const getByEmail = query({
	args: Schema.Struct({ email: Schema.String }),
	returns: Schema.NullOr(UserWithSystemFields),
	handler: (args) =>
		Effect.gen(function* () {
			const ctx = yield* ConfectQueryCtx;
			const user = yield* ctx.db
				.query("users")
				.withIndex("by_email", (q) => q.eq("email", args.email))
				.unique()
				.pipe(Effect.orDie);
			return Option.match(user, {
				onNone: () => null,
				onSome: (u) => ({
					_id: u._id,
					_creationTime: u._creationTime,
					name: u.name,
					email: u.email,
				}),
			});
		}),
});

export const list = query({
	args: Schema.Struct({}),
	returns: Schema.Array(UserWithSystemFields),
	handler: () =>
		Effect.gen(function* () {
			const ctx = yield* ConfectQueryCtx;
			const users = yield* ctx.db.query("users").collect();
			return users.map((u) => ({
				_id: u._id,
				_creationTime: u._creationTime,
				name: u.name,
				email: u.email,
			}));
		}),
});
