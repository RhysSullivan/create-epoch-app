import { Effect, Schema } from "effect";
import {
	ConfectMutationCtx,
	ConfectQueryCtx,
	mutation,
	query,
} from "../confect";

export const list = query({
	args: Schema.Struct({}),
	returns: Schema.Array(
		Schema.Struct({
			_id: Schema.String,
			_creationTime: Schema.Number,
			name: Schema.String,
			message: Schema.String,
		}),
	),
	handler: () =>
		Effect.gen(function* () {
			const ctx = yield* ConfectQueryCtx;
			const entries = yield* ctx.db.query("guestbook").order("desc").take(50);
			return entries.map((e) => ({
				_id: e._id,
				_creationTime: e._creationTime,
				name: e.name,
				message: e.message,
			}));
		}),
});

export const add = mutation({
	args: Schema.Struct({
		name: Schema.String,
		message: Schema.String,
	}),
	returns: Schema.String,
	handler: (args) =>
		Effect.gen(function* () {
			const ctx = yield* ConfectMutationCtx;
			const name = args.name.trim().slice(0, 50);
			const message = args.message.trim().slice(0, 500);

			if (name.length === 0 || message.length === 0) {
				return yield* Effect.die(new Error("Name and message are required"));
			}

			const id = yield* ctx.db
				.insert("guestbook", { name, message })
				.pipe(Effect.orDie);
			return id;
		}),
});
