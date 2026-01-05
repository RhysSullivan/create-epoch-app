import type { Rpc } from "@effect/rpc";
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

type RpcMiddlewareProvides<R extends Rpc.Any> = R extends Rpc.Rpc<
	infer _Tag,
	infer _Payload,
	infer _Success,
	infer _Error,
	infer Middleware
> ? Middleware extends RpcMiddleware.TagClassAny 
	? Middleware["provides"] extends Context.Tag<infer Id, infer _Service> 
		? Id 
		: never
	: never
: never;

type HandlerFn<R extends Rpc.Any, Ctx> = (
	payload: Rpc.Payload<R>
) => Effect.Effect<Rpc.Success<R>, Rpc.Error<R>, Ctx | RpcMiddlewareProvides<R>>;

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
		const maybeMiddleware = Context.getOption(middlewareContext, tag);
		if (Option.isNone(maybeMiddleware)) {
			if (!tag.optional) {
				result = Effect.flatMap(result, () => 
					Effect.fail(new Error(`Missing required middleware: ${tag.key}`))
				);
			}
			continue;
		}
		
		const middleware = maybeMiddleware.value as RpcMiddleware.RpcMiddleware<unknown, unknown>;
		
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

type RpcPayloadEncoded<R extends Rpc.Any> = R extends Rpc.Rpc<
	infer _Tag,
	infer Payload,
	infer _Success,
	infer _Error,
	infer _Middleware
> ? Payload extends Schema.Schema<infer _A, infer E, infer _R> ? E : never
: never;

type RpcExitEncoded<R extends Rpc.Any> = Rpc.ExitEncoded<R>;

const buildHandler = <
	ConfectDataModel extends GenericConfectDataModel,
	R extends Rpc.Any,
	ConvexArgs extends DefaultFunctionArgs,
	ConvexReturns,
>(
	rpc: AnyRpcWithProps,
	handler: (payload: Rpc.Payload<R>) => Effect.Effect<Rpc.Success<R>, Rpc.Error<R>, unknown>,
	databaseSchemas: DatabaseSchemasFromConfectDataModel<ConfectDataModel>,
	middlewareContext: Context.Context<never>,
	functionType: FunctionType,
): {
	args: ReturnType<typeof compileArgsSchema>;
	returns: ReturnType<typeof compileReturnsSchema>;
	handler: (ctx: GenericQueryCtx<DataModelFromConfectDataModel<ConfectDataModel>> | GenericMutationCtx<DataModelFromConfectDataModel<ConfectDataModel>> | GenericActionCtx<DataModelFromConfectDataModel<ConfectDataModel>>, args: ConvexArgs) => Promise<ConvexReturns>;
} => {
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

	const makeHandler = (ctx: RawQueryCtx | RawMutationCtx | RawActionCtx, args: ConvexArgs): Promise<ConvexReturns> =>
		pipe(
			args,
			Schema.decode(rpc.payloadSchema as Schema.Schema<Rpc.Payload<R>, ConvexArgs>),
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
		) as Promise<ConvexReturns>;

	return {
		args: argsValidator,
		returns: returnsValidator,
		handler: makeHandler,
	};
};

export interface RpcHandlerOptions {
	readonly middleware?: Context.Context<never>;
}

export function query<
	ConfectSchema extends GenericConfectSchema,
	R extends Rpc.Any,
	ConvexArgs extends DefaultFunctionArgs = RpcPayloadEncoded<R> & DefaultFunctionArgs,
	ConvexReturns = RpcExitEncoded<R>,
>(
	confectSchemaDefinition: ConfectSchemaDefinition<ConfectSchema>,
	rpc: R,
	handler: HandlerFn<R, ConfectQueryCtxFor<ConfectSchema>>,
	options?: RpcHandlerOptions,
): RegisteredQuery<"public", ConvexArgs, Promise<ConvexReturns>> {
	type ConfectDataModel = ConfectDataModelFromConfectSchema<ConfectSchema>;
	const databaseSchemas = databaseSchemasFromConfectSchema(
		confectSchemaDefinition.confectSchema,
	) as DatabaseSchemasFromConfectDataModel<ConfectDataModel>;

	const rpcWithProps = rpc as unknown as AnyRpcWithProps;
	const config = buildHandler<ConfectDataModel, R, ConvexArgs, ConvexReturns>(
		rpcWithProps,
		handler as (payload: Rpc.Payload<R>) => Effect.Effect<Rpc.Success<R>, Rpc.Error<R>, unknown>,
		databaseSchemas,
		options?.middleware ?? Context.empty(),
		"query",
	);
	return queryGeneric(config) as RegisteredQuery<"public", ConvexArgs, Promise<ConvexReturns>>;
}

export function mutation<
	ConfectSchema extends GenericConfectSchema,
	R extends Rpc.Any,
	ConvexArgs extends DefaultFunctionArgs = RpcPayloadEncoded<R> & DefaultFunctionArgs,
	ConvexReturns = RpcExitEncoded<R>,
>(
	confectSchemaDefinition: ConfectSchemaDefinition<ConfectSchema>,
	rpc: R,
	handler: HandlerFn<R, ConfectMutationCtxFor<ConfectSchema>>,
	options?: RpcHandlerOptions,
): RegisteredMutation<"public", ConvexArgs, Promise<ConvexReturns>> {
	type ConfectDataModel = ConfectDataModelFromConfectSchema<ConfectSchema>;
	const databaseSchemas = databaseSchemasFromConfectSchema(
		confectSchemaDefinition.confectSchema,
	) as DatabaseSchemasFromConfectDataModel<ConfectDataModel>;

	const rpcWithProps = rpc as unknown as AnyRpcWithProps;
	const config = buildHandler<ConfectDataModel, R, ConvexArgs, ConvexReturns>(
		rpcWithProps,
		handler as (payload: Rpc.Payload<R>) => Effect.Effect<Rpc.Success<R>, Rpc.Error<R>, unknown>,
		databaseSchemas,
		options?.middleware ?? Context.empty(),
		"mutation",
	);
	return mutationGeneric(config) as RegisteredMutation<"public", ConvexArgs, Promise<ConvexReturns>>;
}

export function action<
	ConfectSchema extends GenericConfectSchema,
	R extends Rpc.Any,
	ConvexArgs extends DefaultFunctionArgs = RpcPayloadEncoded<R> & DefaultFunctionArgs,
	ConvexReturns = RpcExitEncoded<R>,
>(
	confectSchemaDefinition: ConfectSchemaDefinition<ConfectSchema>,
	rpc: R,
	handler: HandlerFn<R, ConfectActionCtxFor<ConfectSchema>>,
	options?: RpcHandlerOptions,
): RegisteredAction<"public", ConvexArgs, Promise<ConvexReturns>> {
	type ConfectDataModel = ConfectDataModelFromConfectSchema<ConfectSchema>;
	const databaseSchemas = databaseSchemasFromConfectSchema(
		confectSchemaDefinition.confectSchema,
	) as DatabaseSchemasFromConfectDataModel<ConfectDataModel>;

	const rpcWithProps = rpc as unknown as AnyRpcWithProps;
	const config = buildHandler<ConfectDataModel, R, ConvexArgs, ConvexReturns>(
		rpcWithProps,
		handler as (payload: Rpc.Payload<R>) => Effect.Effect<Rpc.Success<R>, Rpc.Error<R>, unknown>,
		databaseSchemas,
		options?.middleware ?? Context.empty(),
		"action",
	);
	return actionGeneric(config) as RegisteredAction<"public", ConvexArgs, Promise<ConvexReturns>>;
}

export function internalQuery<
	ConfectSchema extends GenericConfectSchema,
	R extends Rpc.Any,
	ConvexArgs extends DefaultFunctionArgs = RpcPayloadEncoded<R> & DefaultFunctionArgs,
	ConvexReturns = RpcExitEncoded<R>,
>(
	confectSchemaDefinition: ConfectSchemaDefinition<ConfectSchema>,
	rpc: R,
	handler: HandlerFn<R, ConfectQueryCtxFor<ConfectSchema>>,
	options?: RpcHandlerOptions,
): RegisteredQuery<"internal", ConvexArgs, Promise<ConvexReturns>> {
	type ConfectDataModel = ConfectDataModelFromConfectSchema<ConfectSchema>;
	const databaseSchemas = databaseSchemasFromConfectSchema(
		confectSchemaDefinition.confectSchema,
	) as DatabaseSchemasFromConfectDataModel<ConfectDataModel>;

	const rpcWithProps = rpc as unknown as AnyRpcWithProps;
	const config = buildHandler<ConfectDataModel, R, ConvexArgs, ConvexReturns>(
		rpcWithProps,
		handler as (payload: Rpc.Payload<R>) => Effect.Effect<Rpc.Success<R>, Rpc.Error<R>, unknown>,
		databaseSchemas,
		options?.middleware ?? Context.empty(),
		"query",
	);
	return internalQueryGeneric(config) as RegisteredQuery<"internal", ConvexArgs, Promise<ConvexReturns>>;
}

export function internalMutation<
	ConfectSchema extends GenericConfectSchema,
	R extends Rpc.Any,
	ConvexArgs extends DefaultFunctionArgs = RpcPayloadEncoded<R> & DefaultFunctionArgs,
	ConvexReturns = RpcExitEncoded<R>,
>(
	confectSchemaDefinition: ConfectSchemaDefinition<ConfectSchema>,
	rpc: R,
	handler: HandlerFn<R, ConfectMutationCtxFor<ConfectSchema>>,
	options?: RpcHandlerOptions,
): RegisteredMutation<"internal", ConvexArgs, Promise<ConvexReturns>> {
	type ConfectDataModel = ConfectDataModelFromConfectSchema<ConfectSchema>;
	const databaseSchemas = databaseSchemasFromConfectSchema(
		confectSchemaDefinition.confectSchema,
	) as DatabaseSchemasFromConfectDataModel<ConfectDataModel>;

	const rpcWithProps = rpc as unknown as AnyRpcWithProps;
	const config = buildHandler<ConfectDataModel, R, ConvexArgs, ConvexReturns>(
		rpcWithProps,
		handler as (payload: Rpc.Payload<R>) => Effect.Effect<Rpc.Success<R>, Rpc.Error<R>, unknown>,
		databaseSchemas,
		options?.middleware ?? Context.empty(),
		"mutation",
	);
	return internalMutationGeneric(config) as RegisteredMutation<"internal", ConvexArgs, Promise<ConvexReturns>>;
}

export function internalAction<
	ConfectSchema extends GenericConfectSchema,
	R extends Rpc.Any,
	ConvexArgs extends DefaultFunctionArgs = RpcPayloadEncoded<R> & DefaultFunctionArgs,
	ConvexReturns = RpcExitEncoded<R>,
>(
	confectSchemaDefinition: ConfectSchemaDefinition<ConfectSchema>,
	rpc: R,
	handler: HandlerFn<R, ConfectActionCtxFor<ConfectSchema>>,
	options?: RpcHandlerOptions,
): RegisteredAction<"internal", ConvexArgs, Promise<ConvexReturns>> {
	type ConfectDataModel = ConfectDataModelFromConfectSchema<ConfectSchema>;
	const databaseSchemas = databaseSchemasFromConfectSchema(
		confectSchemaDefinition.confectSchema,
	) as DatabaseSchemasFromConfectDataModel<ConfectDataModel>;

	const rpcWithProps = rpc as unknown as AnyRpcWithProps;
	const config = buildHandler<ConfectDataModel, R, ConvexArgs, ConvexReturns>(
		rpcWithProps,
		handler as (payload: Rpc.Payload<R>) => Effect.Effect<Rpc.Success<R>, Rpc.Error<R>, unknown>,
		databaseSchemas,
		options?.middleware ?? Context.empty(),
		"action",
	);
	return internalActionGeneric(config) as RegisteredAction<"internal", ConvexArgs, Promise<ConvexReturns>>;
}

export type ExtractMiddleware<R extends Rpc.Any> = R extends Rpc.Rpc<
	infer _Tag,
	infer _Payload,
	infer _Success,
	infer _Error,
	infer Middleware
> ? Middleware : never;

export const makeRpcMiddlewareContext = <
	M extends RpcMiddleware.TagClassAny,
	Implementations extends { [K in M["key"]]: Context.Tag.Service<Extract<M, { key: K }>> }
>(
	implementations: Implementations
): Context.Context<M> => {
	let ctx = Context.empty() as Context.Context<M>;
	for (const [key, impl] of Object.entries(implementations)) {
		const tag = { key } as unknown as Context.Tag<M, Context.Tag.Service<M>>;
		ctx = Context.add(ctx, tag, impl as Context.Tag.Service<M>);
	}
	return ctx;
};
