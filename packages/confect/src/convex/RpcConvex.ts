import type { Rpc, RpcGroup } from "@effect/rpc";
import type { RpcMiddleware } from "@effect/rpc";
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
import type { Headers } from "@effect/platform/Headers";

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

type ConfectQueryCtxFor<ConfectSchema extends GenericConfectSchema> = 
	ConfectQueryCtx<ConfectDataModelFromConfectSchema<ConfectSchema>>;

type ConfectMutationCtxFor<ConfectSchema extends GenericConfectSchema> = 
	ConfectMutationCtx<ConfectDataModelFromConfectSchema<ConfectSchema>>;

type ConfectActionCtxFor<ConfectSchema extends GenericConfectSchema> = 
	ConfectActionCtx<ConfectDataModelFromConfectSchema<ConfectSchema>>;

type HandlerFn<R extends Rpc.Any, Ctx> = (
	payload: Rpc.Payload<R>
) => Effect.Effect<Rpc.Success<R>, Rpc.Error<R>, Ctx>;

const getFunctionType = (rpc: AnyRpcWithProps): FunctionType =>
	Option.getOrElse(
		Context.getOption(rpc.annotations, ConvexFunctionType),
		() => "query" as FunctionType,
	);

type MiddlewareOptions = {
	readonly rpc: AnyRpcWithProps;
	readonly payload: unknown;
	readonly clientId: number;
	readonly headers: Headers;
};

const applyMiddleware = <A, E, R>(
	rpc: AnyRpcWithProps,
	middlewareContext: Context.Context<never>,
	payload: unknown,
	handler: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | unknown, R | unknown> => {
	const middlewares = rpc.middlewares as ReadonlySet<RpcMiddleware.TagClassAnyWithProps>;
	if (middlewares.size === 0) {
		return handler;
	}

	const options: MiddlewareOptions = { 
		rpc, 
		payload, 
		clientId: 0, 
		headers: {} as Headers 
	};
	let result: Effect.Effect<A, E | unknown, R | unknown> = handler;

	for (const tag of middlewares) {
		const middleware = Context.unsafeGet(middlewareContext, tag) as RpcMiddleware.RpcMiddleware<unknown, unknown>;
		
		if (tag.wrap) {
			const wrapMiddleware = middleware as unknown as RpcMiddleware.RpcMiddlewareWrap<unknown, unknown>;
			result = wrapMiddleware({
				...options,
				next: result as unknown as Effect.Effect<RpcMiddleware.SuccessValue, unknown, unknown>,
			}) as unknown as Effect.Effect<A, E | unknown, R | unknown>;
		} else if (tag.optional) {
			const previous = result;
			result = Effect.matchEffect(middleware(options), {
				onFailure: () => previous,
				onSuccess: tag.provides !== undefined
					? (value) => Effect.provideService(previous, tag.provides!, value)
					: () => previous,
			});
		} else if (tag.provides !== undefined) {
			result = Effect.provideServiceEffect(
				result,
				tag.provides,
				middleware(options),
			);
		} else {
			result = Effect.zipRight(middleware(options), result);
		}
	}

	return result;
};

type QueryResult<Visibility extends "public" | "internal"> = 
	RegisteredQuery<Visibility, DefaultFunctionArgs, Promise<unknown>>;

type MutationResult<Visibility extends "public" | "internal"> = 
	RegisteredMutation<Visibility, DefaultFunctionArgs, Promise<unknown>>;

type ActionResult<Visibility extends "public" | "internal"> = 
	RegisteredAction<Visibility, DefaultFunctionArgs, Promise<unknown>>;

const buildHandler = <ConfectDataModel extends GenericConfectDataModel>(
	rpc: AnyRpcWithProps,
	handler: (payload: unknown) => Effect.Effect<unknown, unknown, unknown>,
	databaseSchemas: DatabaseSchemasFromConfectDataModel<ConfectDataModel>,
	middlewareContext: Context.Context<never>,
	functionType: FunctionType,
	visibility: "public" | "internal",
) => {
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
				const withMiddleware = applyMiddleware(rpc, middlewareContext, decodedArgs, effect);

				if (functionType === "query") {
					return Effect.provideService(
						withMiddleware as Effect.Effect<unknown, unknown, ConfectQueryCtx<ConfectDataModel>>,
						ConfectQueryCtx<ConfectDataModel>(),
						makeConfectQueryCtx(ctx as RawQueryCtx, databaseSchemas),
					);
				}
				if (functionType === "mutation") {
					return Effect.provideService(
						withMiddleware as Effect.Effect<unknown, unknown, ConfectMutationCtx<ConfectDataModel>>,
						ConfectMutationCtx<ConfectDataModel>(),
						makeConfectMutationCtx(ctx as RawMutationCtx, databaseSchemas),
					);
				}
				return Effect.provideService(
					withMiddleware as Effect.Effect<unknown, unknown, ConfectActionCtx<ConfectDataModel>>,
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

	if (visibility === "public") {
		if (functionType === "query") return queryGeneric(config);
		if (functionType === "mutation") return mutationGeneric(config);
		return actionGeneric(config);
	}
	if (functionType === "query") return internalQueryGeneric(config);
	if (functionType === "mutation") return internalMutationGeneric(config);
	return internalActionGeneric(config);
};

export const query = <
	ConfectSchema extends GenericConfectSchema,
	R extends Rpc.Any,
>(
	confectSchemaDefinition: ConfectSchemaDefinition<ConfectSchema>,
	rpc: R,
	handler: HandlerFn<R, ConfectQueryCtxFor<ConfectSchema>>,
): QueryResult<"public"> => {
	type ConfectDataModel = ConfectDataModelFromConfectSchema<ConfectSchema>;
	const databaseSchemas = databaseSchemasFromConfectSchema(
		confectSchemaDefinition.confectSchema,
	) as DatabaseSchemasFromConfectDataModel<ConfectDataModel>;

	const rpcWithProps = rpc as unknown as AnyRpcWithProps;
	return buildHandler<ConfectDataModel>(
		rpcWithProps,
		handler as (payload: unknown) => Effect.Effect<unknown, unknown, unknown>,
		databaseSchemas,
		Context.empty(),
		"query",
		"public",
	) as QueryResult<"public">;
};

export const mutation = <
	ConfectSchema extends GenericConfectSchema,
	R extends Rpc.Any,
>(
	confectSchemaDefinition: ConfectSchemaDefinition<ConfectSchema>,
	rpc: R,
	handler: HandlerFn<R, ConfectMutationCtxFor<ConfectSchema>>,
): MutationResult<"public"> => {
	type ConfectDataModel = ConfectDataModelFromConfectSchema<ConfectSchema>;
	const databaseSchemas = databaseSchemasFromConfectSchema(
		confectSchemaDefinition.confectSchema,
	) as DatabaseSchemasFromConfectDataModel<ConfectDataModel>;

	const rpcWithProps = rpc as unknown as AnyRpcWithProps;
	return buildHandler<ConfectDataModel>(
		rpcWithProps,
		handler as (payload: unknown) => Effect.Effect<unknown, unknown, unknown>,
		databaseSchemas,
		Context.empty(),
		"mutation",
		"public",
	) as MutationResult<"public">;
};

export const action = <
	ConfectSchema extends GenericConfectSchema,
	R extends Rpc.Any,
>(
	confectSchemaDefinition: ConfectSchemaDefinition<ConfectSchema>,
	rpc: R,
	handler: HandlerFn<R, ConfectActionCtxFor<ConfectSchema>>,
): ActionResult<"public"> => {
	type ConfectDataModel = ConfectDataModelFromConfectSchema<ConfectSchema>;
	const databaseSchemas = databaseSchemasFromConfectSchema(
		confectSchemaDefinition.confectSchema,
	) as DatabaseSchemasFromConfectDataModel<ConfectDataModel>;

	const rpcWithProps = rpc as unknown as AnyRpcWithProps;
	return buildHandler<ConfectDataModel>(
		rpcWithProps,
		handler as (payload: unknown) => Effect.Effect<unknown, unknown, unknown>,
		databaseSchemas,
		Context.empty(),
		"action",
		"public",
	) as ActionResult<"public">;
};

export const internalQuery = <
	ConfectSchema extends GenericConfectSchema,
	R extends Rpc.Any,
>(
	confectSchemaDefinition: ConfectSchemaDefinition<ConfectSchema>,
	rpc: R,
	handler: HandlerFn<R, ConfectQueryCtxFor<ConfectSchema>>,
): QueryResult<"internal"> => {
	type ConfectDataModel = ConfectDataModelFromConfectSchema<ConfectSchema>;
	const databaseSchemas = databaseSchemasFromConfectSchema(
		confectSchemaDefinition.confectSchema,
	) as DatabaseSchemasFromConfectDataModel<ConfectDataModel>;

	const rpcWithProps = rpc as unknown as AnyRpcWithProps;
	return buildHandler<ConfectDataModel>(
		rpcWithProps,
		handler as (payload: unknown) => Effect.Effect<unknown, unknown, unknown>,
		databaseSchemas,
		Context.empty(),
		"query",
		"internal",
	) as QueryResult<"internal">;
};

export const internalMutation = <
	ConfectSchema extends GenericConfectSchema,
	R extends Rpc.Any,
>(
	confectSchemaDefinition: ConfectSchemaDefinition<ConfectSchema>,
	rpc: R,
	handler: HandlerFn<R, ConfectMutationCtxFor<ConfectSchema>>,
): MutationResult<"internal"> => {
	type ConfectDataModel = ConfectDataModelFromConfectSchema<ConfectSchema>;
	const databaseSchemas = databaseSchemasFromConfectSchema(
		confectSchemaDefinition.confectSchema,
	) as DatabaseSchemasFromConfectDataModel<ConfectDataModel>;

	const rpcWithProps = rpc as unknown as AnyRpcWithProps;
	return buildHandler<ConfectDataModel>(
		rpcWithProps,
		handler as (payload: unknown) => Effect.Effect<unknown, unknown, unknown>,
		databaseSchemas,
		Context.empty(),
		"mutation",
		"internal",
	) as MutationResult<"internal">;
};

export const internalAction = <
	ConfectSchema extends GenericConfectSchema,
	R extends Rpc.Any,
>(
	confectSchemaDefinition: ConfectSchemaDefinition<ConfectSchema>,
	rpc: R,
	handler: HandlerFn<R, ConfectActionCtxFor<ConfectSchema>>,
): ActionResult<"internal"> => {
	type ConfectDataModel = ConfectDataModelFromConfectSchema<ConfectSchema>;
	const databaseSchemas = databaseSchemasFromConfectSchema(
		confectSchemaDefinition.confectSchema,
	) as DatabaseSchemasFromConfectDataModel<ConfectDataModel>;

	const rpcWithProps = rpc as unknown as AnyRpcWithProps;
	return buildHandler<ConfectDataModel>(
		rpcWithProps,
		handler as (payload: unknown) => Effect.Effect<unknown, unknown, unknown>,
		databaseSchemas,
		Context.empty(),
		"action",
		"internal",
	) as ActionResult<"internal">;
};
