import { Rpc, RpcGroup } from "@effect/rpc";
import { ConvexFunctionType } from "@packages/confect/convex";
import { Schema } from "effect";
import { AuthPayload } from "./shared";

export class UnauthorizedError extends Schema.TaggedError<UnauthorizedError>()(
	"UnauthorizedError",
	{
		message: Schema.String,
	},
) {}

const AdminPayloadFields = {
	...AuthPayload.fields,
	adminKey: Schema.String,
};

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

export const getStats = Rpc.make("getStats", {
	payload: AdminPayloadFields,
	success: StatsSchema,
	error: UnauthorizedError,
}).annotate(ConvexFunctionType, "query");

export const listUsers = Rpc.make("listUsers", {
	payload: {
		...AdminPayloadFields,
		limit: Schema.optional(Schema.Number),
	},
	success: Schema.Array(UserSchema),
	error: UnauthorizedError,
}).annotate(ConvexFunctionType, "query");

export const deleteGuestbookEntry = Rpc.make("deleteGuestbookEntry", {
	payload: {
		...AdminPayloadFields,
		entryId: Schema.String,
	},
	success: Schema.Void,
	error: UnauthorizedError,
}).annotate(ConvexFunctionType, "mutation");

export class AdminRpcs extends RpcGroup.make(
	getStats,
	listUsers,
	deleteGuestbookEntry,
) {}
