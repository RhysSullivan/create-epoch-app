import { v } from "convex/values";
import {
	customAction,
	customMutation,
	customQuery,
} from "convex-helpers/server/customFunctions";
import { action, mutation, query } from "../_generated/server";
import { createDataAccessCache } from "../shared/dataAccess";

export const publicQuery = customQuery(query, {
	args: {},
	input: async (ctx, args) => {
		const cache = createDataAccessCache(ctx);
		return {
			ctx: { ...ctx, cache },
			args,
		};
	},
});

export const publicMutation = customMutation(mutation, {
	args: {},
	input: async (ctx, args) => {
		const cache = createDataAccessCache(ctx);
		return {
			ctx: { ...ctx, cache },
			args,
		};
	},
});

export const publicAction = customAction(action, {
	args: {},
	input: async (ctx, args) => {
		return {
			ctx,
			args,
		};
	},
});
