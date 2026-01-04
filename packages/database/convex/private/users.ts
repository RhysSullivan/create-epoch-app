import { Effect, Option, Schema } from "effect";
import { Id } from "@packages/confect/server";
import {
	ConfectMutationCtx,
	ConfectQueryCtx,
	internalMutation,
	internalQuery,
} from "../confect";

const UserWithSystemFields = Schema.Struct({
	_id: Schema.String,
	_creationTime: Schema.Number,
	name: Schema.String,
	email: Schema.String,
});

export const create = internalMutation({
	args: Schema.Struct({
		name: Schema.String,
		email: Schema.String,
	}),
	returns: Schema.String,
	handler: (args) =>
		Effect.gen(function* () {
			const ctx = yield* ConfectMutationCtx;
			const id = yield* ctx.db.insert("users", args).pipe(Effect.orDie);
			return id;
		}),
});

export const update = internalMutation({
	args: Schema.Struct({
		id: Id.Id("users"),
		name: Schema.optional(Schema.String),
		email: Schema.optional(Schema.String),
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

export const deleteUser = internalMutation({
	args: Schema.Struct({ id: Id.Id("users") }),
	returns: Schema.Null,
	handler: (args) =>
		Effect.gen(function* () {
			const ctx = yield* ConfectMutationCtx;
			yield* ctx.db.delete(args.id);
			return null;
		}),
});

export const getByEmail = internalQuery({
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

export const upsert = internalMutation({
	args: Schema.Struct({
		name: Schema.String,
		email: Schema.String,
	}),
	returns: Schema.Struct({
		isNew: Schema.Boolean,
		id: Schema.String,
	}),
	handler: (args) =>
		Effect.gen(function* () {
			const ctx = yield* ConfectMutationCtx;
			const existing = yield* ctx.db
				.query("users")
				.withIndex("by_email", (q) => q.eq("email", args.email))
				.unique()
				.pipe(Effect.orDie);

			return yield* Option.match(existing, {
				onNone: () =>
					Effect.gen(function* () {
						const id = yield* ctx.db.insert("users", args).pipe(Effect.orDie);
						return { isNew: true, id };
					}),
				onSome: (user) =>
					Effect.gen(function* () {
						yield* ctx.db
							.patch(user._id, { name: args.name })
							.pipe(Effect.orDie);
						return { isNew: false, id: user._id };
					}),
			});
		}),
});
