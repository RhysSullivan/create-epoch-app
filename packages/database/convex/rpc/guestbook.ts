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

class EmptyFieldError extends Schema.TaggedError<EmptyFieldError>()(
	"EmptyFieldError",
	{ field: Schema.String },
) {}

const guestbookModule = makeRpcModule({
	list: factory.query({ success: Schema.Array(Entry) }, () =>
		Effect.gen(function* () {
			const ctx = yield* ConfectQueryCtx;
			const entries = yield* ctx.db.query("guestbook").order("desc").take(50);
			return entries.map((e) => ({
				_id: String(e._id),
				_creationTime: e._creationTime,
				name: e.name,
				message: e.message,
			}));
		}),
	),

	add: factory.mutation(
		{
			payload: {
				name: Schema.String,
				message: Schema.String,
			},
			success: Schema.String,
			error: EmptyFieldError,
		},
		(args) =>
			Effect.gen(function* () {
				const name = args.name.trim();
				const message = args.message.trim();

				if (name.length === 0) {
					return yield* new EmptyFieldError({ field: "name" });
				}
				if (message.length === 0) {
					return yield* new EmptyFieldError({ field: "message" });
				}

				const ctx = yield* ConfectMutationCtx;
				const id = yield* ctx.db.insert("guestbook", { name, message });
				return String(id);
			}),
	),
});

export const { list, add } = guestbookModule.handlers;
export { guestbookModule, EmptyFieldError };
export type GuestbookModule = typeof guestbookModule;
