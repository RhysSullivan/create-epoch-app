import { Rpc, RpcGroup } from "@packages/confect/rpc";
import { Schema } from "effect";
import { AuthPayload } from "./shared";

export class UnauthorizedError extends Schema.TaggedError<UnauthorizedError>()(
	"UnauthorizedError",
	{
		message: Schema.String,
	},
) {}

const AdminPayload = Schema.extend(
	AuthPayload,
	Schema.Struct({
		adminKey: Schema.String,
	}),
);

export type AdminPayload = typeof AdminPayload.Type;

const UserSchema = Schema.Struct({
	_id: Schema.String,
	email: Schema.String,
	name: Schema.String,
	createdAt: Schema.Number,
});

const StatsSchema = Schema.Struct({
	totalUsers: Schema.Number,
	totalGuestbookEntries: Schema.Number,
	totalPosts: Schema.Number,
});

export const getStats = Rpc.Query("getStats")
	.setPayload(AdminPayload)
	.setSuccess(StatsSchema)
	.setError(UnauthorizedError);

export const listUsers = Rpc.Query("listUsers")
	.setPayload(
		Schema.extend(
			AdminPayload,
			Schema.Struct({
				limit: Schema.optionalWith(Schema.Number, { default: () => 50 }),
			}),
		),
	)
	.setSuccess(Schema.Array(UserSchema))
	.setError(UnauthorizedError);

export const deleteGuestbookEntry = Rpc.Mutation("deleteGuestbookEntry")
	.setPayload(
		Schema.extend(
			AdminPayload,
			Schema.Struct({
				entryId: Schema.String,
			}),
		),
	)
	.setSuccess(Schema.Void)
	.setError(UnauthorizedError);

export const AdminRpcs = RpcGroup.make(
	getStats,
	listUsers,
	deleteGuestbookEntry,
);

export type AdminRpcs = typeof AdminRpcs;
