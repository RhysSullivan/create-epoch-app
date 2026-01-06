import { Context, Schema } from "effect";

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
