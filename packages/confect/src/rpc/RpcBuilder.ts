import { Rpc, RpcGroup } from "@effect/rpc";
import type {
	DefaultFunctionArgs,
	RegisteredMutation,
	RegisteredQuery,
	RegisteredAction,
	GenericQueryCtx,
	GenericMutationCtx,
	GenericActionCtx,
} from "convex/server";
import {
	queryGeneric,
	mutationGeneric,
	actionGeneric,
	internalQueryGeneric,
	internalMutationGeneric,
	internalActionGeneric,
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

type ConfectQueryCtxFor<ConfectSchema extends GenericConfectSchema> = 
	ConfectQueryCtx<ConfectDataModelFromConfectSchema<ConfectSchema>>;

type ConfectMutationCtxFor<ConfectSchema extends GenericConfectSchema> = 
	ConfectMutationCtx<ConfectDataModelFromConfectSchema<ConfectSchema>>;

type ConfectActionCtxFor<ConfectSchema extends GenericConfectSchema> = 
	ConfectActionCtx<ConfectDataModelFromConfectSchema<ConfectSchema>>;

export interface RpcEndpoint<
	Tag extends string,
	R extends Rpc.Any,
	ConvexFn,
> {
	readonly _tag: Tag;
	readonly rpc: R;
	readonly fn: ConvexFn;
}

export interface RpcRef<
	Tag extends string,
	R extends Rpc.Any,
> {
	readonly _tag: Tag;
	readonly rpc: R;
}

export type MiddlewareFn = (
	effect: Effect.Effect<unknown, unknown, unknown>,
	payload: unknown,
) => Effect.Effect<unknown, unknown, unknown>;

export interface RpcFactoryConfig<ConfectSchema extends GenericConfectSchema> {
	readonly schema: ConfectSchemaDefinition<ConfectSchema>;
	readonly middleware?: MiddlewareFn;
}

export const createRpcFactory = <ConfectSchema extends GenericConfectSchema>(
	config: RpcFactoryConfig<ConfectSchema>,
) => {
	type ConfectDataModel = ConfectDataModelFromConfectSchema<ConfectSchema>;
	const databaseSchemas = databaseSchemasFromConfectSchema(
		config.schema.confectSchema,
	) as DatabaseSchemasFromConfectDataModel<ConfectDataModel>;
	const applyMiddleware = config.middleware ?? ((effect, _payload) => effect);

	type RawQueryCtx = GenericQueryCtx<DataModelFromConfectDataModel<ConfectDataModel>>;
	type RawMutationCtx = GenericMutationCtx<DataModelFromConfectDataModel<ConfectDataModel>>;
	type RawActionCtx = GenericActionCtx<DataModelFromConfectDataModel<ConfectDataModel>>;

	const buildQueryHandler = <R extends Rpc.Any>(
		rpc: R,
		handler: (payload: Rpc.Payload<R>) => Effect.Effect<Rpc.Success<R>, Rpc.Error<R>, unknown>,
	) => {
		const rpcWithProps = rpc as unknown as Rpc.AnyWithProps;
		const exitSchema = Schema.Exit({
			success: rpcWithProps.successSchema as Schema.Schema<Rpc.Success<R>>,
			failure: rpcWithProps.errorSchema as Schema.Schema<Rpc.Error<R>>,
			defect: Schema.Defect,
		});

		const argsValidator = compileArgsSchema(rpcWithProps.payloadSchema as Schema.Schema<unknown, DefaultFunctionArgs>);
		const returnsValidator = compileReturnsSchema(exitSchema as Schema.Schema<unknown, unknown>);

		const makeHandler = (ctx: RawQueryCtx, args: DefaultFunctionArgs): Promise<unknown> =>
			pipe(
				args,
				Schema.decode(rpcWithProps.payloadSchema as Schema.Schema<Rpc.Payload<R>, DefaultFunctionArgs>),
				Effect.orDie,
				Effect.flatMap((decodedArgs) => {
					const effect = handler(decodedArgs);
					const withMiddleware = applyMiddleware(effect, decodedArgs);
					return Effect.provideService(
						withMiddleware as Effect.Effect<Rpc.Success<R>, Rpc.Error<R>, ConfectQueryCtx<ConfectDataModel>>,
						ConfectQueryCtx<ConfectDataModel>(),
						makeConfectQueryCtx(ctx, databaseSchemas),
					);
				}),
				Effect.exit,
				Effect.flatMap((exit) => Schema.encode(exitSchema)(exit)),
				Effect.runPromise,
			);

		return {
			args: argsValidator,
			returns: returnsValidator,
			handler: makeHandler,
		};
	};

	const buildMutationHandler = <R extends Rpc.Any>(
		rpc: R,
		handler: (payload: Rpc.Payload<R>) => Effect.Effect<Rpc.Success<R>, Rpc.Error<R>, unknown>,
	) => {
		const rpcWithProps = rpc as unknown as Rpc.AnyWithProps;
		const exitSchema = Schema.Exit({
			success: rpcWithProps.successSchema as Schema.Schema<Rpc.Success<R>>,
			failure: rpcWithProps.errorSchema as Schema.Schema<Rpc.Error<R>>,
			defect: Schema.Defect,
		});

		const argsValidator = compileArgsSchema(rpcWithProps.payloadSchema as Schema.Schema<unknown, DefaultFunctionArgs>);
		const returnsValidator = compileReturnsSchema(exitSchema as Schema.Schema<unknown, unknown>);

		const makeHandler = (ctx: RawMutationCtx, args: DefaultFunctionArgs): Promise<unknown> =>
			pipe(
				args,
				Schema.decode(rpcWithProps.payloadSchema as Schema.Schema<Rpc.Payload<R>, DefaultFunctionArgs>),
				Effect.orDie,
				Effect.flatMap((decodedArgs) => {
					const effect = handler(decodedArgs);
					const withMiddleware = applyMiddleware(effect, decodedArgs);
					return Effect.provideService(
						withMiddleware as Effect.Effect<Rpc.Success<R>, Rpc.Error<R>, ConfectMutationCtx<ConfectDataModel>>,
						ConfectMutationCtx<ConfectDataModel>(),
						makeConfectMutationCtx(ctx, databaseSchemas),
					);
				}),
				Effect.exit,
				Effect.flatMap((exit) => Schema.encode(exitSchema)(exit)),
				Effect.runPromise,
			);

		return {
			args: argsValidator,
			returns: returnsValidator,
			handler: makeHandler,
		};
	};

	const buildActionHandler = <R extends Rpc.Any>(
		rpc: R,
		handler: (payload: Rpc.Payload<R>) => Effect.Effect<Rpc.Success<R>, Rpc.Error<R>, unknown>,
	) => {
		const rpcWithProps = rpc as unknown as Rpc.AnyWithProps;
		const exitSchema = Schema.Exit({
			success: rpcWithProps.successSchema as Schema.Schema<Rpc.Success<R>>,
			failure: rpcWithProps.errorSchema as Schema.Schema<Rpc.Error<R>>,
			defect: Schema.Defect,
		});

		const argsValidator = compileArgsSchema(rpcWithProps.payloadSchema as Schema.Schema<unknown, DefaultFunctionArgs>);
		const returnsValidator = compileReturnsSchema(exitSchema as Schema.Schema<unknown, unknown>);

		const makeHandler = (ctx: RawActionCtx, args: DefaultFunctionArgs): Promise<unknown> =>
			pipe(
				args,
				Schema.decode(rpcWithProps.payloadSchema as Schema.Schema<Rpc.Payload<R>, DefaultFunctionArgs>),
				Effect.orDie,
				Effect.flatMap((decodedArgs) => {
					const effect = handler(decodedArgs);
					const withMiddleware = applyMiddleware(effect, decodedArgs);
					return Effect.provideService(
						withMiddleware as Effect.Effect<Rpc.Success<R>, Rpc.Error<R>, ConfectActionCtx<ConfectDataModel>>,
						ConfectActionCtx<ConfectDataModel>(),
						makeConfectActionCtx(ctx),
					);
				}),
				Effect.exit,
				Effect.flatMap((exit) => Schema.encode(exitSchema)(exit)),
				Effect.runPromise,
			);

		return {
			args: argsValidator,
			returns: returnsValidator,
			handler: makeHandler,
		};
	};

	return {
		query: <
			const Tag extends string,
			PayloadFields extends Schema.Struct.Fields = {},
			Success extends Schema.Schema.Any = typeof Schema.Void,
			Error extends Schema.Schema.All = typeof Schema.Never,
		>(
			tag: Tag,
			options: {
				readonly payload?: PayloadFields;
				readonly success: Success;
				readonly error?: Error;
			},
			handler: (
				payload: Schema.Struct.Type<PayloadFields>,
			) => Effect.Effect<Schema.Schema.Type<Success>, Schema.Schema.Type<Error>, unknown>,
		): RpcEndpoint<
			Tag,
			Rpc.Rpc<Tag, Schema.Struct<PayloadFields>, Success, Error, never>,
			RegisteredQuery<"public", DefaultFunctionArgs, Promise<unknown>>
		> => {
			const rpc = Rpc.make(tag, {
				payload: options.payload,
				success: options.success,
				error: options.error,
			}) as Rpc.Rpc<Tag, Schema.Struct<PayloadFields>, Success, Error, never>;

			const builtHandler = buildQueryHandler(rpc, handler as (payload: Rpc.Payload<typeof rpc>) => Effect.Effect<Rpc.Success<typeof rpc>, Rpc.Error<typeof rpc>, unknown>);
			const fn = queryGeneric(builtHandler);

			return { _tag: tag, rpc, fn };
		},

		mutation: <
			const Tag extends string,
			PayloadFields extends Schema.Struct.Fields = {},
			Success extends Schema.Schema.Any = typeof Schema.Void,
			Error extends Schema.Schema.All = typeof Schema.Never,
		>(
			tag: Tag,
			options: {
				readonly payload?: PayloadFields;
				readonly success: Success;
				readonly error?: Error;
			},
			handler: (
				payload: Schema.Struct.Type<PayloadFields>,
			) => Effect.Effect<Schema.Schema.Type<Success>, Schema.Schema.Type<Error>, unknown>,
		): RpcEndpoint<
			Tag,
			Rpc.Rpc<Tag, Schema.Struct<PayloadFields>, Success, Error, never>,
			RegisteredMutation<"public", DefaultFunctionArgs, Promise<unknown>>
		> => {
			const rpc = Rpc.make(tag, {
				payload: options.payload,
				success: options.success,
				error: options.error,
			}) as Rpc.Rpc<Tag, Schema.Struct<PayloadFields>, Success, Error, never>;

			const builtHandler = buildMutationHandler(rpc, handler as (payload: Rpc.Payload<typeof rpc>) => Effect.Effect<Rpc.Success<typeof rpc>, Rpc.Error<typeof rpc>, unknown>);
			const fn = mutationGeneric(builtHandler);

			return { _tag: tag, rpc, fn };
		},

		action: <
			const Tag extends string,
			PayloadFields extends Schema.Struct.Fields = {},
			Success extends Schema.Schema.Any = typeof Schema.Void,
			Error extends Schema.Schema.All = typeof Schema.Never,
		>(
			tag: Tag,
			options: {
				readonly payload?: PayloadFields;
				readonly success: Success;
				readonly error?: Error;
			},
			handler: (
				payload: Schema.Struct.Type<PayloadFields>,
			) => Effect.Effect<Schema.Schema.Type<Success>, Schema.Schema.Type<Error>, unknown>,
		): RpcEndpoint<
			Tag,
			Rpc.Rpc<Tag, Schema.Struct<PayloadFields>, Success, Error, never>,
			RegisteredAction<"public", DefaultFunctionArgs, Promise<unknown>>
		> => {
			const rpc = Rpc.make(tag, {
				payload: options.payload,
				success: options.success,
				error: options.error,
			}) as Rpc.Rpc<Tag, Schema.Struct<PayloadFields>, Success, Error, never>;

			const builtHandler = buildActionHandler(rpc, handler as (payload: Rpc.Payload<typeof rpc>) => Effect.Effect<Rpc.Success<typeof rpc>, Rpc.Error<typeof rpc>, unknown>);
			const fn = actionGeneric(builtHandler);

			return { _tag: tag, rpc, fn };
		},

		internalQuery: <
			const Tag extends string,
			PayloadFields extends Schema.Struct.Fields = {},
			Success extends Schema.Schema.Any = typeof Schema.Void,
			Error extends Schema.Schema.All = typeof Schema.Never,
		>(
			tag: Tag,
			options: {
				readonly payload?: PayloadFields;
				readonly success: Success;
				readonly error?: Error;
			},
			handler: (
				payload: Schema.Struct.Type<PayloadFields>,
			) => Effect.Effect<Schema.Schema.Type<Success>, Schema.Schema.Type<Error>, unknown>,
		): RpcEndpoint<
			Tag,
			Rpc.Rpc<Tag, Schema.Struct<PayloadFields>, Success, Error, never>,
			RegisteredQuery<"internal", DefaultFunctionArgs, Promise<unknown>>
		> => {
			const rpc = Rpc.make(tag, {
				payload: options.payload,
				success: options.success,
				error: options.error,
			}) as Rpc.Rpc<Tag, Schema.Struct<PayloadFields>, Success, Error, never>;

			const builtHandler = buildQueryHandler(rpc, handler as (payload: Rpc.Payload<typeof rpc>) => Effect.Effect<Rpc.Success<typeof rpc>, Rpc.Error<typeof rpc>, unknown>);
			const fn = internalQueryGeneric(builtHandler);

			return { _tag: tag, rpc, fn };
		},

		internalMutation: <
			const Tag extends string,
			PayloadFields extends Schema.Struct.Fields = {},
			Success extends Schema.Schema.Any = typeof Schema.Void,
			Error extends Schema.Schema.All = typeof Schema.Never,
		>(
			tag: Tag,
			options: {
				readonly payload?: PayloadFields;
				readonly success: Success;
				readonly error?: Error;
			},
			handler: (
				payload: Schema.Struct.Type<PayloadFields>,
			) => Effect.Effect<Schema.Schema.Type<Success>, Schema.Schema.Type<Error>, unknown>,
		): RpcEndpoint<
			Tag,
			Rpc.Rpc<Tag, Schema.Struct<PayloadFields>, Success, Error, never>,
			RegisteredMutation<"internal", DefaultFunctionArgs, Promise<unknown>>
		> => {
			const rpc = Rpc.make(tag, {
				payload: options.payload,
				success: options.success,
				error: options.error,
			}) as Rpc.Rpc<Tag, Schema.Struct<PayloadFields>, Success, Error, never>;

			const builtHandler = buildMutationHandler(rpc, handler as (payload: Rpc.Payload<typeof rpc>) => Effect.Effect<Rpc.Success<typeof rpc>, Rpc.Error<typeof rpc>, unknown>);
			const fn = internalMutationGeneric(builtHandler);

			return { _tag: tag, rpc, fn };
		},

		internalAction: <
			const Tag extends string,
			PayloadFields extends Schema.Struct.Fields = {},
			Success extends Schema.Schema.Any = typeof Schema.Void,
			Error extends Schema.Schema.All = typeof Schema.Never,
		>(
			tag: Tag,
			options: {
				readonly payload?: PayloadFields;
				readonly success: Success;
				readonly error?: Error;
			},
			handler: (
				payload: Schema.Struct.Type<PayloadFields>,
			) => Effect.Effect<Schema.Schema.Type<Success>, Schema.Schema.Type<Error>, unknown>,
		): RpcEndpoint<
			Tag,
			Rpc.Rpc<Tag, Schema.Struct<PayloadFields>, Success, Error, never>,
			RegisteredAction<"internal", DefaultFunctionArgs, Promise<unknown>>
		> => {
			const rpc = Rpc.make(tag, {
				payload: options.payload,
				success: options.success,
				error: options.error,
			}) as Rpc.Rpc<Tag, Schema.Struct<PayloadFields>, Success, Error, never>;

			const builtHandler = buildActionHandler(rpc, handler as (payload: Rpc.Payload<typeof rpc>) => Effect.Effect<Rpc.Success<typeof rpc>, Rpc.Error<typeof rpc>, unknown>);
			const fn = internalActionGeneric(builtHandler);

			return { _tag: tag, rpc, fn };
		},
	};
};

export type InferRpc<E> = E extends RpcEndpoint<infer _Tag, infer R, infer _ConvexFn> ? R : never;

export type InferFn<E> = E extends RpcEndpoint<infer _Tag, infer _R, infer ConvexFn> ? ConvexFn : never;

export interface RpcModule<
	Endpoints extends Record<string, RpcEndpoint<string, Rpc.Any, unknown>>,
> {
	readonly _def: {
		readonly endpoints: Endpoints;
	};
	readonly rpcs: { [K in keyof Endpoints]: InferRpc<Endpoints[K]> };
	readonly handlers: { [K in keyof Endpoints]: InferFn<Endpoints[K]> };
	readonly group: RpcGroup.RpcGroup<InferRpc<Endpoints[keyof Endpoints]>>;
}

export type AnyRpcModule = RpcModule<Record<string, RpcEndpoint<string, Rpc.Any, unknown>>>;

export type InferModuleEndpoints<M extends AnyRpcModule> = M["_def"]["endpoints"];

export const makeRpcModule = <
	Endpoints extends Record<string, RpcEndpoint<string, Rpc.Any, unknown>>,
>(
	endpoints: Endpoints,
): RpcModule<Endpoints> & Endpoints => {
	const rpcs = {} as Record<string, Rpc.Any>;
	const handlers = {} as Record<string, unknown>;
	const rpcList: Rpc.Any[] = [];

	for (const key of Object.keys(endpoints)) {
		const endpoint = endpoints[key]!;
		rpcs[key] = endpoint.rpc;
		handlers[key] = endpoint.fn;
		rpcList.push(endpoint.rpc);
	}

	const module = {
		_def: { endpoints },
		rpcs: rpcs as { [K in keyof Endpoints]: InferRpc<Endpoints[K]> },
		handlers: handlers as { [K in keyof Endpoints]: InferFn<Endpoints[K]> },
		group: RpcGroup.make(...rpcList) as unknown as RpcGroup.RpcGroup<InferRpc<Endpoints[keyof Endpoints]>>,
	};

	return Object.assign(module, endpoints) as RpcModule<Endpoints> & Endpoints;
};
