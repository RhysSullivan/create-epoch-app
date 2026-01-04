import type { ActionCtx, MutationCtx, QueryCtx } from "../client";
import { authComponent } from "./betterAuth";

export async function getAuthUser(ctx: QueryCtx | MutationCtx | ActionCtx) {
	return await authComponent.getAuthUser(ctx);
}

export async function safeGetAuthUser(ctx: QueryCtx | MutationCtx | ActionCtx) {
	return await authComponent.safeGetAuthUser(ctx);
}
