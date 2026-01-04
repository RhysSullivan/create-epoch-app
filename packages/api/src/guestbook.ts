import { Rpc, RpcGroup } from "@packages/confect/rpc";
import { Schema } from "effect";
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

export const list = Rpc.Query("list")
	.setPayload(AuthPayload)
	.setSuccess(Schema.Array(GuestbookEntrySchema));

export const add = Rpc.Mutation("add")
	.setPayload(
		Schema.extend(
			AuthPayload,
			Schema.Struct({
				name: Schema.String,
				message: Schema.String,
			}),
		),
	)
	.setSuccess(Schema.String)
	.setError(ValidationError);

export const GuestbookRpcs = RpcGroup.make(list, add);

export type GuestbookRpcs = typeof GuestbookRpcs;
