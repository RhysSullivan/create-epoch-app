import type { DefaultFunctionArgs, GenericActionCtx, GenericMutationCtx, GenericQueryCtx } from "convex/server";
import {
	actionGeneric,
	internalActionGeneric,
	internalMutationGeneric,
	internalQueryGeneric,
	mutationGeneric,
	queryGeneric,
	type RegisteredAction,
	type RegisteredMutation,
	type RegisteredQuery,
} from "convex/server";
import { Effect, pipe, Schema } from "effect";

import {
	ConfectActionCtx,
	ConfectMutationCtx,
	ConfectQueryCtx,
	makeConfectActionCtx,
	makeConfectMutationCtx,
	makeConfectQueryCtx,
} from "../server/ctx";
import type { DataModelFromConfectDataModel, GenericConfectDataModel } from "../server/data-model";
import {
	type DatabaseSchemasFromConfectDataModel,
	databaseSchemasFromConfectSchema,
} from "../server/database";
import type {
	ConfectDataModelFromConfectSchema,
	ConfectSchemaDefinition,
	GenericConfectSchema,
} from "../server/schema";
import {
	compileArgsSchema,
	compileReturnsSchema,
} from "../server/schema-to-validator";
import type * as Rpc from "./Rpc";
import type { HandlersFrom, RpcGroup, RpcsOf } from "./RpcGroup";

type ConvexModuleResult<R extends Rpc.Any, Visibility extends "public" | "internal"> = {
	[K in R["_tag"]]: 
		| RegisteredQuery<Visibility, DefaultFunctionArgs, Promise<unknown>> 
		| RegisteredMutation<Visibility, DefaultFunctionArgs, Promise<unknown>> 
		| RegisteredAction<Visibility, DefaultFunctionArgs, Promise<unknown>>
};

type ConfectCtx<ConfectSchema extends GenericConfectSchema> =
	| ConfectQueryCtx<ConfectDataModelFromConfectSchema<ConfectSchema>>
	| ConfectMutationCtx<ConfectDataModelFromConfectSchema<ConfectSchema>>
	| ConfectActionCtx<ConfectDataModelFromConfectSchema<ConfectSchema>>;

export const createConvexModule = <
	ConfectSchema extends GenericConfectSchema,
	R extends Rpc.Any,
	Handlers extends HandlersFrom<R, ConfectCtx<ConfectSchema>>,
>(
	confectSchemaDefinition: ConfectSchemaDefinition<ConfectSchema>,
	group: RpcGroup<R>,
	handlers: Handlers,
): ConvexModuleResult<R, "public"> => {
	type ConfectDataModel = ConfectDataModelFromConfectSchema<ConfectSchema>;
	const databaseSchemas = databaseSchemasFromConfectSchema(
		confectSchemaDefinition.confectSchema,
	) as DatabaseSchemasFromConfectDataModel<ConfectDataModel>;

	const result: Record<string, RegisteredQuery<"public", DefaultFunctionArgs, Promise<unknown>> | RegisteredMutation<"public", DefaultFunctionArgs, Promise<unknown>> | RegisteredAction<"public", DefaultFunctionArgs, Promise<unknown>>> = {};

	for (const [tag, rpc] of group.rpcs) {
		const handlerFn = (handlers as Record<string, (payload: unknown) => Effect.Effect<unknown, unknown, ConfectQueryCtx<ConfectDataModel> | ConfectMutationCtx<ConfectDataModel> | ConfectActionCtx<ConfectDataModel>>>)[tag];
		if (!handlerFn) {
			throw new Error(`Missing handler for RPC: ${tag}`);
		}
		result[tag] = buildPublicConvexHandler<ConfectDataModel>(rpc, handlerFn, databaseSchemas);
	}

	return result as ConvexModuleResult<R, "public">;
};

export const createInternalConvexModule = <
	ConfectSchema extends GenericConfectSchema,
	R extends Rpc.Any,
	Handlers extends HandlersFrom<R, ConfectCtx<ConfectSchema>>,
>(
	confectSchemaDefinition: ConfectSchemaDefinition<ConfectSchema>,
	group: RpcGroup<R>,
	handlers: Handlers,
): ConvexModuleResult<R, "internal"> => {
	type ConfectDataModel = ConfectDataModelFromConfectSchema<ConfectSchema>;
	const databaseSchemas = databaseSchemasFromConfectSchema(
		confectSchemaDefinition.confectSchema,
	) as DatabaseSchemasFromConfectDataModel<ConfectDataModel>;

	const result: Record<string, RegisteredQuery<"internal", DefaultFunctionArgs, Promise<unknown>> | RegisteredMutation<"internal", DefaultFunctionArgs, Promise<unknown>> | RegisteredAction<"internal", DefaultFunctionArgs, Promise<unknown>>> = {};

	for (const [tag, rpc] of group.rpcs) {
		const handlerFn = (handlers as Record<string, (payload: unknown) => Effect.Effect<unknown, unknown, ConfectQueryCtx<ConfectDataModel> | ConfectMutationCtx<ConfectDataModel> | ConfectActionCtx<ConfectDataModel>>>)[tag];
		if (!handlerFn) {
			throw new Error(`Missing handler for RPC: ${tag}`);
		}
		result[tag] = buildInternalConvexHandler<ConfectDataModel>(rpc, handlerFn, databaseSchemas);
	}

	return result as ConvexModuleResult<R, "internal">;
};

const buildPublicConvexHandler = <ConfectDataModel extends GenericConfectDataModel>(
	rpc: Rpc.Any,
	handler: (payload: unknown) => Effect.Effect<unknown, unknown, ConfectQueryCtx<ConfectDataModel> | ConfectMutationCtx<ConfectDataModel> | ConfectActionCtx<ConfectDataModel>>,
	databaseSchemas: DatabaseSchemasFromConfectDataModel<ConfectDataModel>,
): RegisteredQuery<"public", DefaultFunctionArgs, Promise<unknown>> | RegisteredMutation<"public", DefaultFunctionArgs, Promise<unknown>> | RegisteredAction<"public", DefaultFunctionArgs, Promise<unknown>> => {
	const exitSchema = Schema.Exit({
		success: rpc.successSchema as Schema.Schema<unknown, unknown>,
		failure: rpc.errorSchema as Schema.Schema<unknown, unknown>,
		defect: Schema.Defect,
	});

	const argsValidator = compileArgsSchema(rpc.payloadSchema as Schema.Schema<unknown, DefaultFunctionArgs>);
	const returnsValidator = compileReturnsSchema(exitSchema);

	type RawQueryCtx = GenericQueryCtx<DataModelFromConfectDataModel<ConfectDataModel>>;
	type RawMutationCtx = GenericMutationCtx<DataModelFromConfectDataModel<ConfectDataModel>>;
	type RawActionCtx = GenericActionCtx<DataModelFromConfectDataModel<ConfectDataModel>>;

	const makeHandler = (ctx: RawQueryCtx | RawMutationCtx | RawActionCtx, args: DefaultFunctionArgs): Promise<unknown> =>
		pipe(
			args,
			Schema.decode(rpc.payloadSchema as Schema.Schema<unknown, DefaultFunctionArgs>),
			Effect.orDie,
			Effect.flatMap((decodedArgs) => {
				const effect = handler(decodedArgs);

				if (rpc._type === "query") {
					return Effect.provideService(
						effect as Effect.Effect<unknown, unknown, ConfectQueryCtx<ConfectDataModel>>,
						ConfectQueryCtx<ConfectDataModel>(),
						makeConfectQueryCtx(ctx as RawQueryCtx, databaseSchemas),
					);
				}
				if (rpc._type === "mutation") {
					return Effect.provideService(
						effect as Effect.Effect<unknown, unknown, ConfectMutationCtx<ConfectDataModel>>,
						ConfectMutationCtx<ConfectDataModel>(),
						makeConfectMutationCtx(ctx as RawMutationCtx, databaseSchemas),
					);
				}
				return Effect.provideService(
					effect as Effect.Effect<unknown, unknown, ConfectActionCtx<ConfectDataModel>>,
					ConfectActionCtx<ConfectDataModel>(),
					makeConfectActionCtx(ctx as RawActionCtx),
				);
			}),
			Effect.exit,
			Effect.flatMap((exit) => Schema.encode(exitSchema)(exit)),
			Effect.runPromise,
		);

	const config = {
		args: argsValidator,
		returns: returnsValidator,
		handler: makeHandler,
	};

	if (rpc._type === "query") {
		return queryGeneric(config);
	}
	if (rpc._type === "mutation") {
		return mutationGeneric(config);
	}
	return actionGeneric(config);
};

const buildInternalConvexHandler = <ConfectDataModel extends GenericConfectDataModel>(
	rpc: Rpc.Any,
	handler: (payload: unknown) => Effect.Effect<unknown, unknown, ConfectQueryCtx<ConfectDataModel> | ConfectMutationCtx<ConfectDataModel> | ConfectActionCtx<ConfectDataModel>>,
	databaseSchemas: DatabaseSchemasFromConfectDataModel<ConfectDataModel>,
): RegisteredQuery<"internal", DefaultFunctionArgs, Promise<unknown>> | RegisteredMutation<"internal", DefaultFunctionArgs, Promise<unknown>> | RegisteredAction<"internal", DefaultFunctionArgs, Promise<unknown>> => {
	const exitSchema = Schema.Exit({
		success: rpc.successSchema as Schema.Schema<unknown, unknown>,
		failure: rpc.errorSchema as Schema.Schema<unknown, unknown>,
		defect: Schema.Defect,
	});

	const argsValidator = compileArgsSchema(rpc.payloadSchema as Schema.Schema<unknown, DefaultFunctionArgs>);
	const returnsValidator = compileReturnsSchema(exitSchema);

	type RawQueryCtx = GenericQueryCtx<DataModelFromConfectDataModel<ConfectDataModel>>;
	type RawMutationCtx = GenericMutationCtx<DataModelFromConfectDataModel<ConfectDataModel>>;
	type RawActionCtx = GenericActionCtx<DataModelFromConfectDataModel<ConfectDataModel>>;

	const makeHandler = (ctx: RawQueryCtx | RawMutationCtx | RawActionCtx, args: DefaultFunctionArgs): Promise<unknown> =>
		pipe(
			args,
			Schema.decode(rpc.payloadSchema as Schema.Schema<unknown, DefaultFunctionArgs>),
			Effect.orDie,
			Effect.flatMap((decodedArgs) => {
				const effect = handler(decodedArgs);

				if (rpc._type === "query") {
					return Effect.provideService(
						effect as Effect.Effect<unknown, unknown, ConfectQueryCtx<ConfectDataModel>>,
						ConfectQueryCtx<ConfectDataModel>(),
						makeConfectQueryCtx(ctx as RawQueryCtx, databaseSchemas),
					);
				}
				if (rpc._type === "mutation") {
					return Effect.provideService(
						effect as Effect.Effect<unknown, unknown, ConfectMutationCtx<ConfectDataModel>>,
						ConfectMutationCtx<ConfectDataModel>(),
						makeConfectMutationCtx(ctx as RawMutationCtx, databaseSchemas),
					);
				}
				return Effect.provideService(
					effect as Effect.Effect<unknown, unknown, ConfectActionCtx<ConfectDataModel>>,
					ConfectActionCtx<ConfectDataModel>(),
					makeConfectActionCtx(ctx as RawActionCtx),
				);
			}),
			Effect.exit,
			Effect.flatMap((exit) => Schema.encode(exitSchema)(exit)),
			Effect.runPromise,
		);

	const config = {
		args: argsValidator,
		returns: returnsValidator,
		handler: makeHandler,
	};

	if (rpc._type === "query") {
		return internalQueryGeneric(config);
	}
	if (rpc._type === "mutation") {
		return internalMutationGeneric(config);
	}
	return internalActionGeneric(config);
};
