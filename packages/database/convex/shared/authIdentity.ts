import type { GenericCtx } from "@convex-dev/better-auth";
import type { UserIdentity } from "convex/server";
import type { DataModel } from "../_generated/dataModel";

type AuthIdentity = UserIdentity & {
	isAnonymous: boolean;
};

export async function getAuthIdentity(
	ctx: GenericCtx<DataModel>,
): Promise<AuthIdentity | null> {
	return ctx.auth.getUserIdentity() as Promise<AuthIdentity | null>;
}
