import { createRpcFactory, makeRpcModule } from "@packages/confect/rpc";
import { Effect, Schema } from "effect";
import { ConfectMutationCtx, ConfectQueryCtx, confectSchema } from "../confect";

const factory = createRpcFactory({
	schema: confectSchema,
	basePayload: {},
	middlewares: [],
});

const GuestbookEntry = Schema.Struct({
	_id: Schema.String,
	_creationTime: Schema.Number,
	name: Schema.String,
	message: Schema.String,
});

export const benchmarkModule = makeRpcModule({
	effectList: factory.query(
		{
			payload: {
				_cacheKey: Schema.optional(Schema.String),
			},
			success: Schema.Array(GuestbookEntry),
		},
		() =>
			Effect.gen(function* () {
				const ctx = yield* ConfectQueryCtx;
				const entries = yield* ctx.db.query("guestbook").order("desc").take(10);
				return entries.map((e) => ({
					_id: e._id,
					_creationTime: e._creationTime,
					name: e.name,
					message: e.message,
				}));
			}),
	),

	effectAdd: factory.mutation(
		{
			payload: {
				name: Schema.String,
				message: Schema.String,
			},
			success: Schema.String,
		},
		(args) =>
			Effect.gen(function* () {
				const ctx = yield* ConfectMutationCtx;
				const name = args.name.trim().slice(0, 50);
				const message = args.message.trim().slice(0, 500);

				const id = yield* ctx.db
					.insert("guestbook", { name, message })
					.pipe(Effect.orDie);
				return id;
			}),
	),

	effectAddDirect: factory.mutation(
		{
			payload: {
				name: Schema.String,
				message: Schema.String,
			},
			success: Schema.String,
		},
		(args) =>
			Effect.gen(function* () {
				const ctx = yield* ConfectMutationCtx;
				const name = args.name.trim().slice(0, 50);
				const message = args.message.trim().slice(0, 500);

				const id = yield* Effect.promise(() =>
					ctx.ctx.db.insert("guestbook", { name, message }),
				);
				return id;
			}),
	),
});

export const { effectList, effectAdd, effectAddDirect } =
	benchmarkModule.handlers;

export type BenchmarkModule = typeof benchmarkModule;
