import type { GenericCtx } from "@convex-dev/better-auth";
import type { DataModel } from "../_generated/dataModel";
import { authComponent } from "./betterAuth";

export async function getAuthUser(ctx: GenericCtx<DataModel>) {
	return await authComponent.getAuthUser(ctx);
}

export async function safeGetAuthUser(ctx: GenericCtx<DataModel>) {
	return await authComponent.safeGetAuthUser(ctx);
}
