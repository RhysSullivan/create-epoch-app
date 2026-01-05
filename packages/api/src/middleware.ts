import { RpcMiddleware } from "@effect/rpc";
import { Context, Effect, Schema } from "effect";

export class AuthenticationError extends Schema.TaggedError<AuthenticationError>()(
	"AuthenticationError",
	{
		message: Schema.String,
	},
) {}

export class AuthenticatedUser extends Context.Tag("AuthenticatedUser")<
	AuthenticatedUser,
	{
		readonly id: string;
		readonly email: string;
	}
>() {}

export class AuthMiddleware extends RpcMiddleware.Tag<AuthMiddleware>()(
	"AuthMiddleware",
	{
		provides: AuthenticatedUser,
		failure: AuthenticationError,
	},
) {}

export const createAuthMiddleware =
	(
		validateToken: (
			token: string,
		) => Effect.Effect<{ id: string; email: string }, AuthenticationError>,
	): RpcMiddleware.RpcMiddleware<
		{ id: string; email: string },
		AuthenticationError
	> =>
	({ payload }) => {
		const token = (payload as { privateAccessKey?: string })?.privateAccessKey;
		if (!token) {
			return Effect.fail(
				new AuthenticationError({ message: "Missing authentication token" }),
			);
		}
		return validateToken(token);
	};
