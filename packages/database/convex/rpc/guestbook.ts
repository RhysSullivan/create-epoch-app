import {
	createRpcFactory,
	makeRpcModule,
	RpcMiddleware,
} from "@packages/confect/rpc";
import { Effect, Schema } from "effect";

import { ConfectMutationCtx, ConfectQueryCtx, confectSchema } from "../confect";
import { AuthenticatedUser, AuthenticationError } from "./middleware";

const VALID_ACCESS_KEY = process.env.PRIVATE_ACCESS_KEY ?? "test-key";

const AuthPayload = {
	privateAccessKey: Schema.String,
};

const authMiddlewareImpl: RpcMiddleware.RpcMiddleware<
	{ readonly id: string; readonly email: string },
	AuthenticationError
> = ({ payload }) => {
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

class AuthMiddleware extends RpcMiddleware.Tag<AuthMiddleware>()(
	"AuthMiddleware",
	{
		provides: AuthenticatedUser,
		failure: AuthenticationError,
	},
) {}

const factory = createRpcFactory({
	schema: confectSchema,
	basePayload: AuthPayload,
	middleware: AuthMiddleware,
	middlewareImpl: authMiddlewareImpl,
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
	list: factory.query({ success: Schema.Array(GuestbookEntry) }, () =>
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
	),

	add: factory.mutation(
		{
			payload: {
				name: Schema.String,
				message: Schema.String,
			},
			success: Schema.String,
			error: ValidationError,
		},
		(args) =>
			Effect.gen(function* () {
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
