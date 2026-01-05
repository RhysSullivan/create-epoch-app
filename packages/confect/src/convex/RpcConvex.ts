import type { Rpc, RpcGroup } from "@effect/rpc";
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
import { Context, Effect, Option, pipe, Schema } from "effect";

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
import { ConvexFunctionType, type FunctionType } from "./ConvexFunctionType";

type AnyRpcWithProps = Rpc.AnyWithProps;

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

type HandlersFrom<R extends Rpc.Any, Ctx> = {
	readonly [K in R["_tag"]]: (
		payload: Rpc.Payload<Extract<R, { readonly _tag: K }>>
	) => Effect.Effect<
		Rpc.Success<Extract<R, { readonly _tag: K }>>,
		Rpc.Error<Extract<R, { readonly _tag: K }>>,
		Ctx
	>;
};

const getFunctionType = (rpc: AnyRpcWithProps): FunctionType =>
	Option.getOrElse(
		Context.getOption(rpc.annotations, ConvexFunctionType),
		() => "query" as FunctionType,
	);

export const toModule = <
	ConfectSchema extends GenericConfectSchema,
	R extends Rpc.Any,
	Handlers extends HandlersFrom<R, ConfectCtx<ConfectSchema>>,
>(
	confectSchemaDefinition: ConfectSchemaDefinition<ConfectSchema>,
	group: RpcGroup.RpcGroup<R>,
	handlers: Handlers,
): ConvexModuleResult<R, "public"> => {
	type ConfectDataModel = ConfectDataModelFromConfectSchema<ConfectSchema>;
	const databaseSchemas = databaseSchemasFromConfectSchema(
		confectSchemaDefinition.confectSchema,
	) as DatabaseSchemasFromConfectDataModel<ConfectDataModel>;

	const result: Record<string, RegisteredQuery<"public", DefaultFunctionArgs, Promise<unknown>> | RegisteredMutation<"public", DefaultFunctionArgs, Promise<unknown>> | RegisteredAction<"public", DefaultFunctionArgs, Promise<unknown>>> = {};

	for (const [tag, rpc] of group.requests) {
		const handlerFn = (handlers as Record<string, (payload: unknown) => Effect.Effect<unknown, unknown, ConfectQueryCtx<ConfectDataModel> | ConfectMutationCtx<ConfectDataModel> | ConfectActionCtx<ConfectDataModel>>>)[tag];
		if (!handlerFn) {
			throw new Error(`Missing handler for RPC: ${tag}`);
		}
		const rpcWithProps = rpc as never as AnyRpcWithProps;
		result[tag] = buildPublicConvexHandler<ConfectDataModel>(rpcWithProps, handlerFn, databaseSchemas);
	}

	return result as ConvexModuleResult<R, "public">;
};

export const toInternalModule = <
	ConfectSchema extends GenericConfectSchema,
	R extends Rpc.Any,
	Handlers extends HandlersFrom<R, ConfectCtx<ConfectSchema>>,
>(
	confectSchemaDefinition: ConfectSchemaDefinition<ConfectSchema>,
	group: RpcGroup.RpcGroup<R>,
	handlers: Handlers,
): ConvexModuleResult<R, "internal"> => {
	type ConfectDataModel = ConfectDataModelFromConfectSchema<ConfectSchema>;
	const databaseSchemas = databaseSchemasFromConfectSchema(
		confectSchemaDefinition.confectSchema,
	) as DatabaseSchemasFromConfectDataModel<ConfectDataModel>;

	const result: Record<string, RegisteredQuery<"internal", DefaultFunctionArgs, Promise<unknown>> | RegisteredMutation<"internal", DefaultFunctionArgs, Promise<unknown>> | RegisteredAction<"internal", DefaultFunctionArgs, Promise<unknown>>> = {};

	for (const [tag, rpc] of group.requests) {
		const handlerFn = (handlers as Record<string, (payload: unknown) => Effect.Effect<unknown, unknown, ConfectQueryCtx<ConfectDataModel> | ConfectMutationCtx<ConfectDataModel> | ConfectActionCtx<ConfectDataModel>>>)[tag];
		if (!handlerFn) {
			throw new Error(`Missing handler for RPC: ${tag}`);
		}
		const rpcWithProps = rpc as never as AnyRpcWithProps;
		result[tag] = buildInternalConvexHandler<ConfectDataModel>(rpcWithProps, handlerFn, databaseSchemas);
	}

	return result as ConvexModuleResult<R, "internal">;
};

const buildPublicConvexHandler = <ConfectDataModel extends GenericConfectDataModel>(
	rpc: AnyRpcWithProps,
	handler: (payload: unknown) => Effect.Effect<unknown, unknown, ConfectQueryCtx<ConfectDataModel> | ConfectMutationCtx<ConfectDataModel> | ConfectActionCtx<ConfectDataModel>>,
	databaseSchemas: DatabaseSchemasFromConfectDataModel<ConfectDataModel>,
): RegisteredQuery<"public", DefaultFunctionArgs, Promise<unknown>> | RegisteredMutation<"public", DefaultFunctionArgs, Promise<unknown>> | RegisteredAction<"public", DefaultFunctionArgs, Promise<unknown>> => {
	const functionType = getFunctionType(rpc);
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

				if (functionType === "query") {
					return Effect.provideService(
						effect as Effect.Effect<unknown, unknown, ConfectQueryCtx<ConfectDataModel>>,
						ConfectQueryCtx<ConfectDataModel>(),
						makeConfectQueryCtx(ctx as RawQueryCtx, databaseSchemas),
					);
				}
				if (functionType === "mutation") {
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

	if (functionType === "query") {
		return queryGeneric(config);
	}
	if (functionType === "mutation") {
		return mutationGeneric(config);
	}
	return actionGeneric(config);
};

const buildInternalConvexHandler = <ConfectDataModel extends GenericConfectDataModel>(
	rpc: AnyRpcWithProps,
	handler: (payload: unknown) => Effect.Effect<unknown, unknown, ConfectQueryCtx<ConfectDataModel> | ConfectMutationCtx<ConfectDataModel> | ConfectActionCtx<ConfectDataModel>>,
	databaseSchemas: DatabaseSchemasFromConfectDataModel<ConfectDataModel>,
): RegisteredQuery<"internal", DefaultFunctionArgs, Promise<unknown>> | RegisteredMutation<"internal", DefaultFunctionArgs, Promise<unknown>> | RegisteredAction<"internal", DefaultFunctionArgs, Promise<unknown>> => {
	const functionType = getFunctionType(rpc);
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

				if (functionType === "query") {
					return Effect.provideService(
						effect as Effect.Effect<unknown, unknown, ConfectQueryCtx<ConfectDataModel>>,
						ConfectQueryCtx<ConfectDataModel>(),
						makeConfectQueryCtx(ctx as RawQueryCtx, databaseSchemas),
					);
				}
				if (functionType === "mutation") {
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

	if (functionType === "query") {
		return internalQueryGeneric(config);
	}
	if (functionType === "mutation") {
		return internalMutationGeneric(config);
	}
	return internalActionGeneric(config);
};

export const toModuleQuery = <
	ConfectSchema extends GenericConfectSchema,
	R extends Rpc.Any,
>(
	confectSchemaDefinition: ConfectSchemaDefinition<ConfectSchema>,
	rpc: R,
	handler: (
		payload: Rpc.Payload<R>
	) => Effect.Effect<
		Rpc.Success<R>,
		Rpc.Error<R>,
		ConfectQueryCtx<ConfectDataModelFromConfectSchema<ConfectSchema>>
	>,
): RegisteredQuery<"public", DefaultFunctionArgs, Promise<unknown>> => {
	type ConfectDataModel = ConfectDataModelFromConfectSchema<ConfectSchema>;
	const databaseSchemas = databaseSchemasFromConfectSchema(
		confectSchemaDefinition.confectSchema,
	) as DatabaseSchemasFromConfectDataModel<ConfectDataModel>;

	const rpcWithProps = rpc as never as AnyRpcWithProps;
	const exitSchema = Schema.Exit({
		success: rpcWithProps.successSchema as Schema.Schema<unknown, unknown>,
		failure: rpcWithProps.errorSchema as Schema.Schema<unknown, unknown>,
		defect: Schema.Defect,
	});

	const argsValidator = compileArgsSchema(rpcWithProps.payloadSchema as Schema.Schema<unknown, DefaultFunctionArgs>);
	const returnsValidator = compileReturnsSchema(exitSchema);

	type RawQueryCtx = GenericQueryCtx<DataModelFromConfectDataModel<ConfectDataModel>>;

	const makeHandler = (ctx: RawQueryCtx, args: DefaultFunctionArgs): Promise<unknown> =>
		pipe(
			args,
			Schema.decode(rpcWithProps.payloadSchema as Schema.Schema<unknown, DefaultFunctionArgs>),
			Effect.orDie,
			Effect.flatMap((decodedArgs) => {
				const effect = handler(decodedArgs as Rpc.Payload<R>);
				return Effect.provideService(
					effect as Effect.Effect<unknown, unknown, ConfectQueryCtx<ConfectDataModel>>,
					ConfectQueryCtx<ConfectDataModel>(),
					makeConfectQueryCtx(ctx, databaseSchemas),
				);
			}),
			Effect.exit,
			Effect.flatMap((exit) => Schema.encode(exitSchema)(exit)),
			Effect.runPromise,
		);

	return queryGeneric({
		args: argsValidator,
		returns: returnsValidator,
		handler: makeHandler,
	});
};

export const toModuleMutation = <
	ConfectSchema extends GenericConfectSchema,
	R extends Rpc.Any,
>(
	confectSchemaDefinition: ConfectSchemaDefinition<ConfectSchema>,
	rpc: R,
	handler: (
		payload: Rpc.Payload<R>
	) => Effect.Effect<
		Rpc.Success<R>,
		Rpc.Error<R>,
		ConfectMutationCtx<ConfectDataModelFromConfectSchema<ConfectSchema>>
	>,
): RegisteredMutation<"public", DefaultFunctionArgs, Promise<unknown>> => {
	type ConfectDataModel = ConfectDataModelFromConfectSchema<ConfectSchema>;
	const databaseSchemas = databaseSchemasFromConfectSchema(
		confectSchemaDefinition.confectSchema,
	) as DatabaseSchemasFromConfectDataModel<ConfectDataModel>;

	const rpcWithProps = rpc as never as AnyRpcWithProps;
	const exitSchema = Schema.Exit({
		success: rpcWithProps.successSchema as Schema.Schema<unknown, unknown>,
		failure: rpcWithProps.errorSchema as Schema.Schema<unknown, unknown>,
		defect: Schema.Defect,
	});

	const argsValidator = compileArgsSchema(rpcWithProps.payloadSchema as Schema.Schema<unknown, DefaultFunctionArgs>);
	const returnsValidator = compileReturnsSchema(exitSchema);

	type RawMutationCtx = GenericMutationCtx<DataModelFromConfectDataModel<ConfectDataModel>>;

	const makeHandler = (ctx: RawMutationCtx, args: DefaultFunctionArgs): Promise<unknown> =>
		pipe(
			args,
			Schema.decode(rpcWithProps.payloadSchema as Schema.Schema<unknown, DefaultFunctionArgs>),
			Effect.orDie,
			Effect.flatMap((decodedArgs) => {
				const effect = handler(decodedArgs as Rpc.Payload<R>);
				return Effect.provideService(
					effect as Effect.Effect<unknown, unknown, ConfectMutationCtx<ConfectDataModel>>,
					ConfectMutationCtx<ConfectDataModel>(),
					makeConfectMutationCtx(ctx, databaseSchemas),
				);
			}),
			Effect.exit,
			Effect.flatMap((exit) => Schema.encode(exitSchema)(exit)),
			Effect.runPromise,
		);

	return mutationGeneric({
		args: argsValidator,
		returns: returnsValidator,
		handler: makeHandler,
	});
};

export const toModuleAction = <
	ConfectSchema extends GenericConfectSchema,
	R extends Rpc.Any,
>(
	confectSchemaDefinition: ConfectSchemaDefinition<ConfectSchema>,
	rpc: R,
	handler: (
		payload: Rpc.Payload<R>
	) => Effect.Effect<
		Rpc.Success<R>,
		Rpc.Error<R>,
		ConfectActionCtx<ConfectDataModelFromConfectSchema<ConfectSchema>>
	>,
): RegisteredAction<"public", DefaultFunctionArgs, Promise<unknown>> => {
	type ConfectDataModel = ConfectDataModelFromConfectSchema<ConfectSchema>;

	const rpcWithProps = rpc as never as AnyRpcWithProps;
	const exitSchema = Schema.Exit({
		success: rpcWithProps.successSchema as Schema.Schema<unknown, unknown>,
		failure: rpcWithProps.errorSchema as Schema.Schema<unknown, unknown>,
		defect: Schema.Defect,
	});

	const argsValidator = compileArgsSchema(rpcWithProps.payloadSchema as Schema.Schema<unknown, DefaultFunctionArgs>);
	const returnsValidator = compileReturnsSchema(exitSchema);

	type RawActionCtx = GenericActionCtx<DataModelFromConfectDataModel<ConfectDataModel>>;

	const makeHandler = (ctx: RawActionCtx, args: DefaultFunctionArgs): Promise<unknown> =>
		pipe(
			args,
			Schema.decode(rpcWithProps.payloadSchema as Schema.Schema<unknown, DefaultFunctionArgs>),
			Effect.orDie,
			Effect.flatMap((decodedArgs) => {
				const effect = handler(decodedArgs as Rpc.Payload<R>);
				return Effect.provideService(
					effect as Effect.Effect<unknown, unknown, ConfectActionCtx<ConfectDataModel>>,
					ConfectActionCtx<ConfectDataModel>(),
					makeConfectActionCtx(ctx),
				);
			}),
			Effect.exit,
			Effect.flatMap((exit) => Schema.encode(exitSchema)(exit)),
			Effect.runPromise,
		);

	return actionGeneric({
		args: argsValidator,
		returns: returnsValidator,
		handler: makeHandler,
	});
};
