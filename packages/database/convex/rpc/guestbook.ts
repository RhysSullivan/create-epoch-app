import { createRpcFactory, makeRpcModule } from "@packages/confect/rpc";
import { Effect, Schema } from "effect";
import { ConfectMutationCtx, ConfectQueryCtx, confectSchema } from "../confect";

const factory = createRpcFactory({ schema: confectSchema });

const Entry = Schema.Struct({
	_id: Schema.String,
	_creationTime: Schema.Number,
	name: Schema.String,
	message: Schema.String,
});

const guestbookModule = makeRpcModule(confectSchema, {
	list: factory.query({ success: Schema.Array(Entry) }, () =>
		Effect.gen(function* () {
			const ctx = yield* ConfectQueryCtx;
			const entries = yield* ctx.db.query("guestbook").collect();
			return entries.map((e) => ({
				_id: e._id,
				_creationTime: e._creationTime,
				name: e.name,
				message: e.message,
			}));
		}),
	),

	add: factory.mutation(
		{
			payload: Schema.Struct({
				name: Schema.String,
				message: Schema.String,
			}),
			success: Schema.String,
		},
		(args) =>
			Effect.gen(function* () {
				const ctx = yield* ConfectMutationCtx;
				const id = yield* ctx.db.insert("guestbook", {
					name: args.name,
					message: args.message,
				});
				return id;
			}),
	),
});

export const { list, add } = guestbookModule.handlers;
export { guestbookModule };
export type GuestbookModule = typeof guestbookModule;
