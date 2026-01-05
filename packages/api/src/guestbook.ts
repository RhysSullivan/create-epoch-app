import { Rpc, RpcGroup } from "@effect/rpc";
import { ConvexFunctionType } from "@packages/confect/convex";
import { Schema } from "effect";
import { AuthMiddleware, AuthenticationError } from "./middleware";
import { AuthPayload } from "./shared";

export class ValidationError extends Schema.TaggedError<ValidationError>()(
	"ValidationError",
	{
		message: Schema.String,
	},
) {}

const GuestbookEntrySchema = Schema.Struct({
	_id: Schema.String,
	_creationTime: Schema.Number,
	name: Schema.String,
	message: Schema.String,
});

export const list = Rpc.make("list", {
	payload: AuthPayload.fields,
	success: Schema.Array(GuestbookEntrySchema),
	error: AuthenticationError,
})
	.middleware(AuthMiddleware)
	.annotate(ConvexFunctionType, "query");

export const add = Rpc.make("add", {
	payload: {
		...AuthPayload.fields,
		name: Schema.String,
		message: Schema.String,
	},
	success: Schema.String,
	error: Schema.Union(ValidationError, AuthenticationError),
})
	.middleware(AuthMiddleware)
	.annotate(ConvexFunctionType, "mutation");

export class GuestbookRpcs extends RpcGroup.make(list, add) {}
