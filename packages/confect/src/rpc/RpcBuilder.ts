import { Rpc, RpcGroup, RpcMiddleware } from "@effect/rpc";
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
import { Context, Effect, pipe, Schema } from "effect";

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

export interface UnbuiltRpcEndpoint<
	PayloadFields extends Schema.Struct.Fields,
	Success extends Schema.Schema.Any,
	Error extends Schema.Schema.All,
	ConvexFnType,
> {
	readonly __unbuilt: true;
	readonly kind: string;
	readonly options: {
		readonly payload?: PayloadFields;
		readonly success: Success;
		readonly error?: Error;
	};
	readonly handler: (
		payload: Schema.Struct.Type<PayloadFields>,
	) => Effect.Effect<Schema.Schema.Type<Success>, Schema.Schema.Type<Error>, unknown>;
	readonly build: (tag: string) => RpcEndpoint<string, Rpc.Any, ConvexFnType>;
}



type MiddlewareOptionsFromTag<T> = T extends RpcMiddleware.TagClass<infer _Self, infer _Name, infer Options>
	? Options
	: never;

type MiddlewareProvides<T extends RpcMiddleware.TagClassAny> = T extends { readonly provides: Context.Tag<infer Id, infer _S> }
	? Id
	: never;

type MiddlewareFailure<T extends RpcMiddleware.TagClassAny> = RpcMiddleware.TagClass.Failure<MiddlewareOptionsFromTag<T>>;

export interface MiddlewareEntry<T extends RpcMiddleware.TagClassAny = RpcMiddleware.TagClassAny> {
	readonly tag: T;
	readonly impl: Context.Tag.Service<T>;
}

type MiddlewaresProvides<T extends ReadonlyArray<MiddlewareEntry>> = T[number] extends MiddlewareEntry<infer M>
	? MiddlewareProvides<M>
	: never;

type MiddlewaresFailure<T extends ReadonlyArray<MiddlewareEntry>> = T[number] extends MiddlewareEntry<infer M>
	? MiddlewareFailure<M>
	: never;

export interface RpcFactoryConfig<
	ConfectSchema extends GenericConfectSchema,
	BasePayload extends Schema.Struct.Fields = {},
	Middlewares extends ReadonlyArray<MiddlewareEntry> = [],
> {
	readonly schema: ConfectSchemaDefinition<ConfectSchema>;
	readonly basePayload?: BasePayload;
	readonly middlewares?: Middlewares;
}

export const createRpcFactory = <
	ConfectSchema extends GenericConfectSchema,
	BasePayload extends Schema.Struct.Fields = {},
	Middlewares extends ReadonlyArray<MiddlewareEntry> = [],
>(
	config: RpcFactoryConfig<ConfectSchema, BasePayload, Middlewares>,
) => {
	type ConfectDataModel = ConfectDataModelFromConfectSchema<ConfectSchema>;
	const databaseSchemas = databaseSchemasFromConfectSchema(
		config.schema.confectSchema,
	) as DatabaseSchemasFromConfectDataModel<ConfectDataModel>;
	const basePayload = config.basePayload ?? ({} as BasePayload);
	const middlewares = config.middlewares ?? [];

	type RawQueryCtx = GenericQueryCtx<DataModelFromConfectDataModel<ConfectDataModel>>;
	type RawMutationCtx = GenericMutationCtx<DataModelFromConfectDataModel<ConfectDataModel>>;
	type RawActionCtx = GenericActionCtx<DataModelFromConfectDataModel<ConfectDataModel>>;

	type MWProvides = MiddlewaresProvides<Middlewares>;
	type MWFailure = MiddlewaresFailure<Middlewares>;

	const applyMiddleware = <A, E, R>(
		effect: Effect.Effect<A, E, R>,
		payload: unknown,
	): Effect.Effect<A, E | MWFailure, Exclude<R, MWProvides>> => {
		if (middlewares.length === 0) {
			return effect as Effect.Effect<A, E | MWFailure, Exclude<R, MWProvides>>;
		}

		const options = {
			clientId: 0,
			rpc: {} as Rpc.AnyWithProps,
			payload,
			headers: {} as import("@effect/platform/Headers").Headers,
		};

		let result = effect as Effect.Effect<A, E | MWFailure, Exclude<R, MWProvides>>;

		for (const middleware of middlewares) {
			const middlewareTag = middleware.tag as RpcMiddleware.TagClassAnyWithProps;
			const impl = middleware.impl as RpcMiddleware.RpcMiddleware<unknown, unknown>;

			if (middlewareTag.provides !== undefined) {
				result = Effect.provideServiceEffect(
					result,
					middlewareTag.provides,
					impl(options),
				) as Effect.Effect<A, E | MWFailure, Exclude<R, MWProvides>>;
			} else {
				result = Effect.zipRight(
					impl(options),
					result,
				) as Effect.Effect<A, E | MWFailure, Exclude<R, MWProvides>>;
			}
		}

		return result;
	};

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

	type MergedPayload<P extends Schema.Struct.Fields> = BasePayload & P;

	type AllowedQueryRequirements = ConfectQueryCtx<ConfectDataModel> | MWProvides;
	type AllowedMutationRequirements = ConfectMutationCtx<ConfectDataModel> | MWProvides;
	type AllowedActionRequirements = ConfectActionCtx<ConfectDataModel> | MWProvides;

	return {
		query: <
			PayloadFields extends Schema.Struct.Fields = {},
			Success extends Schema.Schema.Any = typeof Schema.Void,
			Error extends Schema.Schema.All = typeof Schema.Never,
		>(
			options: {
				readonly payload?: PayloadFields;
				readonly success: Success;
				readonly error?: Error;
			},
			handler: (
				payload: Schema.Struct.Type<MergedPayload<PayloadFields>>,
			) => Effect.Effect<Schema.Schema.Type<Success>, Schema.Schema.Type<Error>, AllowedQueryRequirements>,
		): UnbuiltRpcEndpoint<
			MergedPayload<PayloadFields>,
			Success,
			Error,
			RegisteredQuery<"public", DefaultFunctionArgs, Promise<unknown>>
		> => ({
			__unbuilt: true as const,
			kind: "query" as const,
			options: { ...options, payload: { ...basePayload, ...options.payload } as MergedPayload<PayloadFields> },
			handler,
			build: (tag: string) => {
				const mergedPayload = { ...basePayload, ...options.payload } as MergedPayload<PayloadFields>;
				const rpc = Rpc.make(tag, {
					payload: mergedPayload,
					success: options.success,
					error: options.error,
				});

				const builtHandler = buildQueryHandler(rpc, handler as (payload: Rpc.Payload<typeof rpc>) => Effect.Effect<Rpc.Success<typeof rpc>, Rpc.Error<typeof rpc>, AllowedQueryRequirements>);
				const fn = queryGeneric(builtHandler);

				return { _tag: tag, rpc, fn };
			},
		}),

		mutation: <
			PayloadFields extends Schema.Struct.Fields = {},
			Success extends Schema.Schema.Any = typeof Schema.Void,
			Error extends Schema.Schema.All = typeof Schema.Never,
		>(
			options: {
				readonly payload?: PayloadFields;
				readonly success: Success;
				readonly error?: Error;
			},
			handler: (
				payload: Schema.Struct.Type<MergedPayload<PayloadFields>>,
			) => Effect.Effect<Schema.Schema.Type<Success>, Schema.Schema.Type<Error>, AllowedMutationRequirements>,
		): UnbuiltRpcEndpoint<
			MergedPayload<PayloadFields>,
			Success,
			Error,
			RegisteredMutation<"public", DefaultFunctionArgs, Promise<unknown>>
		> => ({
			__unbuilt: true as const,
			kind: "mutation" as const,
			options: { ...options, payload: { ...basePayload, ...options.payload } as MergedPayload<PayloadFields> },
			handler,
			build: (tag: string) => {
				const mergedPayload = { ...basePayload, ...options.payload } as MergedPayload<PayloadFields>;
				const rpc = Rpc.make(tag, {
					payload: mergedPayload,
					success: options.success,
					error: options.error,
				});

				const builtHandler = buildMutationHandler(rpc, handler as (payload: Rpc.Payload<typeof rpc>) => Effect.Effect<Rpc.Success<typeof rpc>, Rpc.Error<typeof rpc>, AllowedMutationRequirements>);
				const fn = mutationGeneric(builtHandler);

				return { _tag: tag, rpc, fn };
			},
		}),

		action: <
			PayloadFields extends Schema.Struct.Fields = {},
			Success extends Schema.Schema.Any = typeof Schema.Void,
			Error extends Schema.Schema.All = typeof Schema.Never,
		>(
			options: {
				readonly payload?: PayloadFields;
				readonly success: Success;
				readonly error?: Error;
			},
			handler: (
				payload: Schema.Struct.Type<MergedPayload<PayloadFields>>,
			) => Effect.Effect<Schema.Schema.Type<Success>, Schema.Schema.Type<Error>, AllowedActionRequirements>,
		): UnbuiltRpcEndpoint<
			MergedPayload<PayloadFields>,
			Success,
			Error,
			RegisteredAction<"public", DefaultFunctionArgs, Promise<unknown>>
		> => ({
			__unbuilt: true as const,
			kind: "action" as const,
			options: { ...options, payload: { ...basePayload, ...options.payload } as MergedPayload<PayloadFields> },
			handler,
			build: (tag: string) => {
				const mergedPayload = { ...basePayload, ...options.payload } as MergedPayload<PayloadFields>;
				const rpc = Rpc.make(tag, {
					payload: mergedPayload,
					success: options.success,
					error: options.error,
				});

				const builtHandler = buildActionHandler(rpc, handler as (payload: Rpc.Payload<typeof rpc>) => Effect.Effect<Rpc.Success<typeof rpc>, Rpc.Error<typeof rpc>, AllowedActionRequirements>);
				const fn = actionGeneric(builtHandler);

				return { _tag: tag, rpc, fn };
			},
		}),

		internalQuery: <
			PayloadFields extends Schema.Struct.Fields = {},
			Success extends Schema.Schema.Any = typeof Schema.Void,
			Error extends Schema.Schema.All = typeof Schema.Never,
		>(
			options: {
				readonly payload?: PayloadFields;
				readonly success: Success;
				readonly error?: Error;
			},
			handler: (
				payload: Schema.Struct.Type<MergedPayload<PayloadFields>>,
			) => Effect.Effect<Schema.Schema.Type<Success>, Schema.Schema.Type<Error>, AllowedQueryRequirements>,
		): UnbuiltRpcEndpoint<
			MergedPayload<PayloadFields>,
			Success,
			Error,
			RegisteredQuery<"internal", DefaultFunctionArgs, Promise<unknown>>
		> => ({
			__unbuilt: true as const,
			kind: "internalQuery" as const,
			options: { ...options, payload: { ...basePayload, ...options.payload } as MergedPayload<PayloadFields> },
			handler,
			build: (tag: string) => {
				const mergedPayload = { ...basePayload, ...options.payload } as MergedPayload<PayloadFields>;
				const rpc = Rpc.make(tag, {
					payload: mergedPayload,
					success: options.success,
					error: options.error,
				});

				const builtHandler = buildQueryHandler(rpc, handler as (payload: Rpc.Payload<typeof rpc>) => Effect.Effect<Rpc.Success<typeof rpc>, Rpc.Error<typeof rpc>, AllowedQueryRequirements>);
				const fn = internalQueryGeneric(builtHandler);

				return { _tag: tag, rpc, fn };
			},
		}),

		internalMutation: <
			PayloadFields extends Schema.Struct.Fields = {},
			Success extends Schema.Schema.Any = typeof Schema.Void,
			Error extends Schema.Schema.All = typeof Schema.Never,
		>(
			options: {
				readonly payload?: PayloadFields;
				readonly success: Success;
				readonly error?: Error;
			},
			handler: (
				payload: Schema.Struct.Type<MergedPayload<PayloadFields>>,
			) => Effect.Effect<Schema.Schema.Type<Success>, Schema.Schema.Type<Error>, AllowedMutationRequirements>,
		): UnbuiltRpcEndpoint<
			MergedPayload<PayloadFields>,
			Success,
			Error,
			RegisteredMutation<"internal", DefaultFunctionArgs, Promise<unknown>>
		> => ({
			__unbuilt: true as const,
			kind: "internalMutation" as const,
			options: { ...options, payload: { ...basePayload, ...options.payload } as MergedPayload<PayloadFields> },
			handler,
			build: (tag: string) => {
				const mergedPayload = { ...basePayload, ...options.payload } as MergedPayload<PayloadFields>;
				const rpc = Rpc.make(tag, {
					payload: mergedPayload,
					success: options.success,
					error: options.error,
				});

				const builtHandler = buildMutationHandler(rpc, handler as (payload: Rpc.Payload<typeof rpc>) => Effect.Effect<Rpc.Success<typeof rpc>, Rpc.Error<typeof rpc>, AllowedMutationRequirements>);
				const fn = internalMutationGeneric(builtHandler);

				return { _tag: tag, rpc, fn };
			},
		}),

		internalAction: <
			PayloadFields extends Schema.Struct.Fields = {},
			Success extends Schema.Schema.Any = typeof Schema.Void,
			Error extends Schema.Schema.All = typeof Schema.Never,
		>(
			options: {
				readonly payload?: PayloadFields;
				readonly success: Success;
				readonly error?: Error;
			},
			handler: (
				payload: Schema.Struct.Type<MergedPayload<PayloadFields>>,
			) => Effect.Effect<Schema.Schema.Type<Success>, Schema.Schema.Type<Error>, AllowedActionRequirements>,
		): UnbuiltRpcEndpoint<
			MergedPayload<PayloadFields>,
			Success,
			Error,
			RegisteredAction<"internal", DefaultFunctionArgs, Promise<unknown>>
		> => ({
			__unbuilt: true as const,
			kind: "internalAction" as const,
			options: { ...options, payload: { ...basePayload, ...options.payload } as MergedPayload<PayloadFields> },
			handler,
			build: (tag: string) => {
				const mergedPayload = { ...basePayload, ...options.payload } as MergedPayload<PayloadFields>;
				const rpc = Rpc.make(tag, {
					payload: mergedPayload,
					success: options.success,
					error: options.error,
				});

				const builtHandler = buildActionHandler(rpc, handler as (payload: Rpc.Payload<typeof rpc>) => Effect.Effect<Rpc.Success<typeof rpc>, Rpc.Error<typeof rpc>, AllowedActionRequirements>);
				const fn = internalActionGeneric(builtHandler);

				return { _tag: tag, rpc, fn };
			},
		}),
	};
};

export type InferRpc<E> = E extends RpcEndpoint<infer _Tag, infer R, infer _ConvexFn> ? R : never;

export type InferFn<E> = E extends RpcEndpoint<infer _Tag, infer _R, infer ConvexFn> ? ConvexFn : never;

interface RpcModuleBase<
	Endpoints extends Record<string, RpcEndpoint<string, Rpc.Any, unknown>>,
> {
	readonly _def: {
		readonly endpoints: Endpoints;
	};
	readonly rpcs: { [K in keyof Endpoints]: InferRpc<Endpoints[K]> };
	readonly handlers: { [K in keyof Endpoints]: InferFn<Endpoints[K]> };
	readonly group: RpcGroup.RpcGroup<InferRpc<Endpoints[keyof Endpoints]>>;
}

export type RpcModule<
	Endpoints extends Record<string, RpcEndpoint<string, Rpc.Any, unknown>>,
> = RpcModuleBase<Endpoints> & Endpoints;

export type AnyRpcModule = RpcModuleBase<Record<string, RpcEndpoint<string, Rpc.Any, unknown>>>;

export type InferModuleEndpoints<M extends AnyRpcModule> = M["_def"]["endpoints"];

type AnyUnbuiltEndpoint = UnbuiltRpcEndpoint<any, any, any, any>;

type BuiltEndpoint<K extends string, U> = U extends UnbuiltRpcEndpoint<
	infer PayloadFields,
	infer Success,
	infer Error,
	infer ConvexFnType
>
	? RpcEndpoint<K, Rpc.Rpc<K, Schema.Struct<PayloadFields>, Success, Error, never>, ConvexFnType>
	: never;

type BuiltEndpoints<T extends Record<string, AnyUnbuiltEndpoint>> = {
	[K in keyof T & string]: BuiltEndpoint<K, T[K]>;
};

const isUnbuilt = (value: unknown): value is AnyUnbuiltEndpoint =>
	typeof value === "object" && value !== null && "__unbuilt" in value && value.__unbuilt === true;

export function makeRpcModule<
	const T extends Record<string, AnyUnbuiltEndpoint>,
>(
	unbuiltEndpoints: T,
): RpcModuleBase<BuiltEndpoints<T>> & { readonly [K in keyof T]: BuiltEndpoint<K & string, T[K]> } {
	const rpcs = {} as Record<string, Rpc.Any>;
	const handlers = {} as Record<string, unknown>;
	const rpcList: Rpc.Any[] = [];
	const builtEndpoints = {} as Record<string, RpcEndpoint<string, Rpc.Any, unknown>>;

	for (const key of Object.keys(unbuiltEndpoints)) {
		const unbuilt = unbuiltEndpoints[key]!;
		if (!isUnbuilt(unbuilt)) {
			throw new Error(`Expected unbuilt endpoint for key "${key}"`);
		}
		const endpoint = unbuilt.build(key);
		builtEndpoints[key] = endpoint;
		rpcs[key] = endpoint.rpc;
		handlers[key] = endpoint.fn;
		rpcList.push(endpoint.rpc);
	}

	type Built = BuiltEndpoints<T>;
	const module = {
		_def: { endpoints: builtEndpoints },
		rpcs: rpcs as { [K in keyof Built]: InferRpc<Built[K]> },
		handlers: handlers as { [K in keyof Built]: InferFn<Built[K]> },
		group: RpcGroup.make(...rpcList) as unknown as RpcGroup.RpcGroup<InferRpc<Built[keyof Built]>>,
	};

	return Object.assign(module, builtEndpoints) as RpcModuleBase<Built> & { readonly [K in keyof T]: BuiltEndpoint<K & string, T[K]> };
}
