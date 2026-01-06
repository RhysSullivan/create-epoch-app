import {
	AuthenticatedUser,
	AuthenticationError,
} from "@packages/api/middleware";
import { createRpcFactory, makeRpcModule } from "@packages/confect/rpc";
import { Effect, Schema } from "effect";

import { ConfectMutationCtx, ConfectQueryCtx, confectSchema } from "../confect";

const VALID_ACCESS_KEY = process.env.PRIVATE_ACCESS_KEY ?? "test-key";

const validateAuth = (payload: unknown) => {
	const token = (payload as { privateAccessKey?: string })?.privateAccessKey;
	if (!token) {
		return Effect.fail(
			new AuthenticationError({ message: "Missing authentication token" }),
		);
	}
	if (token !== VALID_ACCESS_KEY) {
		return Effect.fail(
			new AuthenticationError({ message: "Invalid access key" }),
		);
	}
	return Effect.succeed({ id: "system", email: "system@example.com" });
};

const factory = createRpcFactory({
	schema: confectSchema,
	middleware: (effect, payload) =>
		Effect.provideServiceEffect(
			effect,
			AuthenticatedUser,
			validateAuth(payload),
		),
});

export class ValidationError extends Schema.TaggedError<ValidationError>()(
	"ValidationError",
	{ message: Schema.String },
) {}

const GuestbookEntry = Schema.Struct({
	_id: Schema.String,
	_creationTime: Schema.Number,
	name: Schema.String,
	message: Schema.String,
});

export const guestbookModule = makeRpcModule({
	list: factory.query(
		{
			payload: { privateAccessKey: Schema.String },
			success: Schema.Array(GuestbookEntry),
		},
		() =>
			Effect.gen(function* () {
				yield* AuthenticatedUser;
				const ctx = yield* ConfectQueryCtx;
				const entries = yield* ctx.db.query("guestbook").order("desc").take(50);
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
			payload: {
				privateAccessKey: Schema.String,
				name: Schema.String,
				message: Schema.String,
			},
			success: Schema.String,
			error: ValidationError,
		},
		(args) =>
			Effect.gen(function* () {
				yield* AuthenticatedUser;
				const ctx = yield* ConfectMutationCtx;
				const name = args.name.trim().slice(0, 50);
				const message = args.message.trim().slice(0, 500);

				if (name.length === 0 || message.length === 0) {
					yield* new ValidationError({
						message: "Name and message are required",
					});
				}

				const id = yield* ctx.db
					.insert("guestbook", { name, message })
					.pipe(Effect.orDie);
				return id;
			}),
	),
});

export const { list, add } = guestbookModule.handlers;

export const GuestbookRpcs = guestbookModule.group;

export type GuestbookEndpoints = typeof guestbookModule._def.endpoints;
export type GuestbookModule = typeof guestbookModule;
