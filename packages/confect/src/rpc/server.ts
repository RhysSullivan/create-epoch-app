import { Rpc, RpcGroup, RpcMiddleware } from "@effect/rpc";
import type {
	DefaultFunctionArgs,
	RegisteredMutation,
	RegisteredQuery,
	RegisteredAction,
	GenericQueryCtx,
	GenericMutationCtx,
	GenericActionCtx,
	GenericDataModel,
} from "convex/server";
import {
	queryGeneric,
	mutationGeneric,
	actionGeneric,
	internalQueryGeneric,
	internalMutationGeneric,
	internalActionGeneric,
} from "convex/server";
import { v } from "convex/values";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import type * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import {
	ConfectActionCtx,
	ConfectMutationCtx,
	ConfectQueryCtx,
	makeQueryCtx,
	makeMutationCtx,
	makeActionCtx,
	type GenericConfectSchema,
	type TableNamesInSchema,
	type DocumentFromTable,
	type EncodedDocumentFromTable,
} from "../ctx";
import type { ConfectSchemaDefinition } from "../schema";

type TableSchemas<Tables extends GenericConfectSchema> = {
	[TableName in TableNamesInSchema<Tables>]: Schema.Schema<
		DocumentFromTable<Tables, TableName>,
		EncodedDocumentFromTable<Tables, TableName>
	>;
};

const extractTableSchemas = <Tables extends GenericConfectSchema>(
	tables: Tables,
): TableSchemas<Tables> => {
	const result: Record<string, Schema.Schema.AnyNoContext> = {};
	for (const [tableName, tableDef] of Object.entries(tables)) {
		result[tableName] = (tableDef as { documentSchema: Schema.Schema.AnyNoContext }).documentSchema;
	}
	return result as TableSchemas<Tables>;
};

export interface RpcEndpoint<
	Tag extends string,
	R extends Rpc.Any,
	ConvexFn,
> {
	readonly _tag: Tag;
	readonly rpc: R;
	readonly fn: ConvexFn;
}

export interface UnbuiltRpcEndpoint<
	PayloadFields extends Schema.Struct.Fields,
	Success extends Schema.Schema.AnyNoContext,
	Error extends Schema.Schema.AnyNoContext | undefined,
	ConvexFnType,
> {
	readonly __unbuilt: true;
	readonly kind: string;
	readonly payloadFields: PayloadFields;
	readonly successSchema: Success;
	readonly errorSchema: Error | undefined;
	readonly handler: (
		payload: Schema.Struct.Type<PayloadFields>,
	) => Effect.Effect<Schema.Schema.Type<Success>, Error extends Schema.Schema.AnyNoContext ? Schema.Schema.Type<Error> : never, unknown>;
	readonly build: (tag: string) => RpcEndpoint<string, Rpc.Any, ConvexFnType>;
}

type MiddlewareProvides<T extends RpcMiddleware.TagClassAny> = T extends {
	readonly provides: Context.Tag<infer Id, infer _S>;
}
	? Id
	: never;

type MiddlewareFailure<T extends RpcMiddleware.TagClassAny> = T extends {
	readonly failure: Schema.Schema<infer A, infer _I, infer _R>;
}
	? A
	: never;

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

export type ExitEncoded<A = unknown, E = unknown, D = unknown> = Schema.ExitEncoded<A, E, D>;

const applyMiddleware = <A, E, R, Middlewares extends ReadonlyArray<MiddlewareEntry>>(
	effect: Effect.Effect<A, E, R>,
	payload: unknown,
	middlewares: Middlewares,
): Effect.Effect<A, E | MiddlewaresFailure<Middlewares>, Exclude<R, MiddlewaresProvides<Middlewares>>> => {
	if (middlewares.length === 0) {
		return effect as Effect.Effect<A, E | MiddlewaresFailure<Middlewares>, Exclude<R, MiddlewaresProvides<Middlewares>>>;
	}

	const options = {
		clientId: 0,
		rpc: {} as Rpc.AnyWithProps,
		payload,
		headers: {} as import("@effect/platform/Headers").Headers,
	};

	let result = effect as Effect.Effect<A, E | MiddlewaresFailure<Middlewares>, Exclude<R, MiddlewaresProvides<Middlewares>>>;

	for (const middleware of middlewares) {
		const middlewareTag = middleware.tag as RpcMiddleware.TagClassAny & {
			provides?: Context.Tag<unknown, unknown>;
			optional?: boolean;
			wrap?: boolean;
		};
		const impl = middleware.impl as RpcMiddleware.RpcMiddleware<unknown, unknown>;

		if (middlewareTag.wrap) {
			const wrapImpl = impl as unknown as RpcMiddleware.RpcMiddlewareWrap<unknown, unknown>;
			result = wrapImpl({ ...options, next: result as unknown as Effect.Effect<RpcMiddleware.SuccessValue, unknown, unknown> }) as unknown as typeof result;
		} else if (middlewareTag.optional) {
			const previous = result;
			result = Effect.matchEffect(impl(options), {
				onFailure: () => previous,
				onSuccess: middlewareTag.provides !== undefined
					? (value) => Effect.provideService(previous, middlewareTag.provides as Context.Tag<unknown, unknown>, value)
					: (_) => previous,
			}) as typeof result;
		} else if (middlewareTag.provides !== undefined) {
			result = Effect.provideServiceEffect(
				result,
				middlewareTag.provides,
				impl(options),
			) as typeof result;
		} else {
			result = Effect.zipRight(
				impl(options),
				result,
			) as typeof result;
		}
	}

	return result;
};

export const createRpcFactory = <
	ConfectSchema extends GenericConfectSchema,
	BasePayload extends Schema.Struct.Fields = {},
	Middlewares extends ReadonlyArray<MiddlewareEntry> = [],
>(
	config: RpcFactoryConfig<ConfectSchema, BasePayload, Middlewares>,
) => {
	const tableSchemas = extractTableSchemas(config.schema.tables);
	const basePayload = config.basePayload ?? ({} as BasePayload);
	const middlewares = config.middlewares ?? ([] as unknown as Middlewares);

	type MWProvides = MiddlewaresProvides<Middlewares>;
	type MWFailure = MiddlewaresFailure<Middlewares>;

	type MergedPayload<P extends Schema.Struct.Fields> = BasePayload & P;

	type AllowedQueryRequirements = ConfectQueryCtx<ConfectSchema> | MWProvides;
	type AllowedMutationRequirements = ConfectMutationCtx<ConfectSchema> | MWProvides;
	type AllowedActionRequirements = ConfectActionCtx<ConfectSchema> | MWProvides;

	const makeHandler = <Ctx>(
		ctxTag: Context.Tag<Ctx, Ctx>,
		makeCtxFn: (rawCtx: GenericQueryCtx<GenericDataModel> | GenericMutationCtx<GenericDataModel> | GenericActionCtx<GenericDataModel>) => Ctx,
	) => <
		PayloadFields extends Schema.Struct.Fields,
		Success extends Schema.Schema.AnyNoContext,
		Error extends Schema.Schema.AnyNoContext | undefined,
	>(
		payloadFields: PayloadFields,
		successSchema: Success,
		errorSchema: Error,
		handler: (payload: Schema.Struct.Type<PayloadFields>) => Effect.Effect<Schema.Schema.Type<Success>, Error extends Schema.Schema.AnyNoContext ? Schema.Schema.Type<Error> : never, Ctx | MWProvides>,
	) => {
		const payloadSchema = Schema.Struct(payloadFields) as unknown as Schema.Schema<Schema.Struct.Type<PayloadFields>, Schema.Struct.Encoded<PayloadFields>, never>;
		const decodePayload = Schema.decodeUnknownSync(payloadSchema);
		
		const exitSchema = Schema.Exit({
			success: successSchema as Schema.Schema<unknown, unknown, never>,
			failure: (errorSchema ?? Schema.Never) as Schema.Schema<unknown, unknown, never>,
			defect: Schema.Defect,
		});
		const encodeExit = Schema.encodeSync(exitSchema) as (exit: Exit.Exit<unknown, unknown>) => ExitEncoded;

		return async (rawCtx: GenericQueryCtx<GenericDataModel> | GenericMutationCtx<GenericDataModel> | GenericActionCtx<GenericDataModel>, args: unknown): Promise<ExitEncoded> => {
			let decodedArgs: Schema.Struct.Type<PayloadFields>;
			try {
				decodedArgs = decodePayload(args);
			} catch (err) {
				return encodeExit(Exit.die(err));
			}

			const handlerEffect = handler(decodedArgs);
			const withMiddleware = applyMiddleware(handlerEffect, decodedArgs, middlewares);
			const effect = Effect.provideService(
				withMiddleware as Effect.Effect<Schema.Schema.Type<Success>, unknown, Ctx>,
				ctxTag,
				makeCtxFn(rawCtx),
			);

			const exit = await Effect.runPromiseExit(effect);
			return encodeExit(exit);
		};
	};

	const queryHandler = makeHandler(
		ConfectQueryCtx<ConfectSchema>(),
		(ctx) => makeQueryCtx(ctx as GenericQueryCtx<GenericDataModel>, tableSchemas),
	);

	const mutationHandler = makeHandler(
		ConfectMutationCtx<ConfectSchema>(),
		(ctx) => makeMutationCtx(ctx as GenericMutationCtx<GenericDataModel>, tableSchemas),
	);

	const actionHandler = makeHandler(
		ConfectActionCtx<ConfectSchema>(),
		(ctx) => makeActionCtx(ctx as GenericActionCtx<GenericDataModel>),
	);

	return {
		query: <
			PayloadFields extends Schema.Struct.Fields = {},
			Success extends Schema.Schema.AnyNoContext = typeof Schema.Void,
			Error extends Schema.Schema.AnyNoContext | undefined = undefined,
		>(
			options: {
				readonly payload?: PayloadFields;
				readonly success: Success;
				readonly error?: Error;
			},
			handler: (
				payload: Schema.Struct.Type<MergedPayload<PayloadFields>>,
			) => Effect.Effect<Schema.Schema.Type<Success>, Error extends Schema.Schema.AnyNoContext ? Schema.Schema.Type<Error> : never, AllowedQueryRequirements>,
		): UnbuiltRpcEndpoint<
			MergedPayload<PayloadFields>,
			Success,
			Error,
			RegisteredQuery<"public", DefaultFunctionArgs, Promise<ExitEncoded>>
		> => {
			const mergedPayload = { ...basePayload, ...options.payload } as MergedPayload<PayloadFields>;
			return {
				__unbuilt: true as const,
				kind: "query" as const,
				payloadFields: mergedPayload,
				successSchema: options.success,
				errorSchema: options.error,
				handler: handler as (payload: Schema.Struct.Type<MergedPayload<PayloadFields>>) => Effect.Effect<Schema.Schema.Type<Success>, Error extends Schema.Schema.AnyNoContext ? Schema.Schema.Type<Error> : never, unknown>,
				build: (tag: string): RpcEndpoint<string, Rpc.Any, RegisteredQuery<"public", DefaultFunctionArgs, Promise<ExitEncoded>>> => {
					const rpc = Rpc.make(tag, {
						payload: mergedPayload,
						success: options.success,
						error: options.error,
					});
					const handlerFn = queryHandler(mergedPayload, options.success, options.error, handler as (payload: Schema.Struct.Type<MergedPayload<PayloadFields>>) => Effect.Effect<Schema.Schema.Type<Success>, Error extends Schema.Schema.AnyNoContext ? Schema.Schema.Type<Error> : never, ConfectQueryCtx<ConfectSchema> | MWProvides>);
					const fn = queryGeneric({ args: v.any(), handler: handlerFn });
					return { _tag: tag, rpc, fn };
				},
			};
		},

		mutation: <
			PayloadFields extends Schema.Struct.Fields = {},
			Success extends Schema.Schema.AnyNoContext = typeof Schema.Void,
			Error extends Schema.Schema.AnyNoContext | undefined = undefined,
		>(
			options: {
				readonly payload?: PayloadFields;
				readonly success: Success;
				readonly error?: Error;
			},
			handler: (
				payload: Schema.Struct.Type<MergedPayload<PayloadFields>>,
			) => Effect.Effect<Schema.Schema.Type<Success>, Error extends Schema.Schema.AnyNoContext ? Schema.Schema.Type<Error> : never, AllowedMutationRequirements>,
		): UnbuiltRpcEndpoint<
			MergedPayload<PayloadFields>,
			Success,
			Error,
			RegisteredMutation<"public", DefaultFunctionArgs, Promise<ExitEncoded>>
		> => {
			const mergedPayload = { ...basePayload, ...options.payload } as MergedPayload<PayloadFields>;
			return {
				__unbuilt: true as const,
				kind: "mutation" as const,
				payloadFields: mergedPayload,
				successSchema: options.success,
				errorSchema: options.error,
				handler: handler as (payload: Schema.Struct.Type<MergedPayload<PayloadFields>>) => Effect.Effect<Schema.Schema.Type<Success>, Error extends Schema.Schema.AnyNoContext ? Schema.Schema.Type<Error> : never, unknown>,
				build: (tag: string): RpcEndpoint<string, Rpc.Any, RegisteredMutation<"public", DefaultFunctionArgs, Promise<ExitEncoded>>> => {
					const rpc = Rpc.make(tag, {
						payload: mergedPayload,
						success: options.success,
						error: options.error,
					});
					const handlerFn = mutationHandler(mergedPayload, options.success, options.error, handler as (payload: Schema.Struct.Type<MergedPayload<PayloadFields>>) => Effect.Effect<Schema.Schema.Type<Success>, Error extends Schema.Schema.AnyNoContext ? Schema.Schema.Type<Error> : never, ConfectMutationCtx<ConfectSchema> | MWProvides>);
					const fn = mutationGeneric({ args: v.any(), handler: handlerFn });
					return { _tag: tag, rpc, fn };
				},
			};
		},

		action: <
			PayloadFields extends Schema.Struct.Fields = {},
			Success extends Schema.Schema.AnyNoContext = typeof Schema.Void,
			Error extends Schema.Schema.AnyNoContext | undefined = undefined,
		>(
			options: {
				readonly payload?: PayloadFields;
				readonly success: Success;
				readonly error?: Error;
			},
			handler: (
				payload: Schema.Struct.Type<MergedPayload<PayloadFields>>,
			) => Effect.Effect<Schema.Schema.Type<Success>, Error extends Schema.Schema.AnyNoContext ? Schema.Schema.Type<Error> : never, AllowedActionRequirements>,
		): UnbuiltRpcEndpoint<
			MergedPayload<PayloadFields>,
			Success,
			Error,
			RegisteredAction<"public", DefaultFunctionArgs, Promise<ExitEncoded>>
		> => {
			const mergedPayload = { ...basePayload, ...options.payload } as MergedPayload<PayloadFields>;
			return {
				__unbuilt: true as const,
				kind: "action" as const,
				payloadFields: mergedPayload,
				successSchema: options.success,
				errorSchema: options.error,
				handler: handler as (payload: Schema.Struct.Type<MergedPayload<PayloadFields>>) => Effect.Effect<Schema.Schema.Type<Success>, Error extends Schema.Schema.AnyNoContext ? Schema.Schema.Type<Error> : never, unknown>,
				build: (tag: string): RpcEndpoint<string, Rpc.Any, RegisteredAction<"public", DefaultFunctionArgs, Promise<ExitEncoded>>> => {
					const rpc = Rpc.make(tag, {
						payload: mergedPayload,
						success: options.success,
						error: options.error,
					});
					const handlerFn = actionHandler(mergedPayload, options.success, options.error, handler as (payload: Schema.Struct.Type<MergedPayload<PayloadFields>>) => Effect.Effect<Schema.Schema.Type<Success>, Error extends Schema.Schema.AnyNoContext ? Schema.Schema.Type<Error> : never, ConfectActionCtx<ConfectSchema> | MWProvides>);
					const fn = actionGeneric({ args: v.any(), handler: handlerFn });
					return { _tag: tag, rpc, fn };
				},
			};
		},

		internalQuery: <
			PayloadFields extends Schema.Struct.Fields = {},
			Success extends Schema.Schema.AnyNoContext = typeof Schema.Void,
			Error extends Schema.Schema.AnyNoContext | undefined = undefined,
		>(
			options: {
				readonly payload?: PayloadFields;
				readonly success: Success;
				readonly error?: Error;
			},
			handler: (
				payload: Schema.Struct.Type<MergedPayload<PayloadFields>>,
			) => Effect.Effect<Schema.Schema.Type<Success>, Error extends Schema.Schema.AnyNoContext ? Schema.Schema.Type<Error> : never, AllowedQueryRequirements>,
		): UnbuiltRpcEndpoint<
			MergedPayload<PayloadFields>,
			Success,
			Error,
			RegisteredQuery<"internal", DefaultFunctionArgs, Promise<ExitEncoded>>
		> => {
			const mergedPayload = { ...basePayload, ...options.payload } as MergedPayload<PayloadFields>;
			return {
				__unbuilt: true as const,
				kind: "internalQuery" as const,
				payloadFields: mergedPayload,
				successSchema: options.success,
				errorSchema: options.error,
				handler: handler as (payload: Schema.Struct.Type<MergedPayload<PayloadFields>>) => Effect.Effect<Schema.Schema.Type<Success>, Error extends Schema.Schema.AnyNoContext ? Schema.Schema.Type<Error> : never, unknown>,
				build: (tag: string): RpcEndpoint<string, Rpc.Any, RegisteredQuery<"internal", DefaultFunctionArgs, Promise<ExitEncoded>>> => {
					const rpc = Rpc.make(tag, {
						payload: mergedPayload,
						success: options.success,
						error: options.error,
					});
					const handlerFn = queryHandler(mergedPayload, options.success, options.error, handler as (payload: Schema.Struct.Type<MergedPayload<PayloadFields>>) => Effect.Effect<Schema.Schema.Type<Success>, Error extends Schema.Schema.AnyNoContext ? Schema.Schema.Type<Error> : never, ConfectQueryCtx<ConfectSchema> | MWProvides>);
					const fn = internalQueryGeneric({ args: v.any(), handler: handlerFn });
					return { _tag: tag, rpc, fn };
				},
			};
		},

		internalMutation: <
			PayloadFields extends Schema.Struct.Fields = {},
			Success extends Schema.Schema.AnyNoContext = typeof Schema.Void,
			Error extends Schema.Schema.AnyNoContext | undefined = undefined,
		>(
			options: {
				readonly payload?: PayloadFields;
				readonly success: Success;
				readonly error?: Error;
			},
			handler: (
				payload: Schema.Struct.Type<MergedPayload<PayloadFields>>,
			) => Effect.Effect<Schema.Schema.Type<Success>, Error extends Schema.Schema.AnyNoContext ? Schema.Schema.Type<Error> : never, AllowedMutationRequirements>,
		): UnbuiltRpcEndpoint<
			MergedPayload<PayloadFields>,
			Success,
			Error,
			RegisteredMutation<"internal", DefaultFunctionArgs, Promise<ExitEncoded>>
		> => {
			const mergedPayload = { ...basePayload, ...options.payload } as MergedPayload<PayloadFields>;
			return {
				__unbuilt: true as const,
				kind: "internalMutation" as const,
				payloadFields: mergedPayload,
				successSchema: options.success,
				errorSchema: options.error,
				handler: handler as (payload: Schema.Struct.Type<MergedPayload<PayloadFields>>) => Effect.Effect<Schema.Schema.Type<Success>, Error extends Schema.Schema.AnyNoContext ? Schema.Schema.Type<Error> : never, unknown>,
				build: (tag: string): RpcEndpoint<string, Rpc.Any, RegisteredMutation<"internal", DefaultFunctionArgs, Promise<ExitEncoded>>> => {
					const rpc = Rpc.make(tag, {
						payload: mergedPayload,
						success: options.success,
						error: options.error,
					});
					const handlerFn = mutationHandler(mergedPayload, options.success, options.error, handler as (payload: Schema.Struct.Type<MergedPayload<PayloadFields>>) => Effect.Effect<Schema.Schema.Type<Success>, Error extends Schema.Schema.AnyNoContext ? Schema.Schema.Type<Error> : never, ConfectMutationCtx<ConfectSchema> | MWProvides>);
					const fn = internalMutationGeneric({ args: v.any(), handler: handlerFn });
					return { _tag: tag, rpc, fn };
				},
			};
		},

		internalAction: <
			PayloadFields extends Schema.Struct.Fields = {},
			Success extends Schema.Schema.AnyNoContext = typeof Schema.Void,
			Error extends Schema.Schema.AnyNoContext | undefined = undefined,
		>(
			options: {
				readonly payload?: PayloadFields;
				readonly success: Success;
				readonly error?: Error;
			},
			handler: (
				payload: Schema.Struct.Type<MergedPayload<PayloadFields>>,
			) => Effect.Effect<Schema.Schema.Type<Success>, Error extends Schema.Schema.AnyNoContext ? Schema.Schema.Type<Error> : never, AllowedActionRequirements>,
		): UnbuiltRpcEndpoint<
			MergedPayload<PayloadFields>,
			Success,
			Error,
			RegisteredAction<"internal", DefaultFunctionArgs, Promise<ExitEncoded>>
		> => {
			const mergedPayload = { ...basePayload, ...options.payload } as MergedPayload<PayloadFields>;
			return {
				__unbuilt: true as const,
				kind: "internalAction" as const,
				payloadFields: mergedPayload,
				successSchema: options.success,
				errorSchema: options.error,
				handler: handler as (payload: Schema.Struct.Type<MergedPayload<PayloadFields>>) => Effect.Effect<Schema.Schema.Type<Success>, Error extends Schema.Schema.AnyNoContext ? Schema.Schema.Type<Error> : never, unknown>,
				build: (tag: string): RpcEndpoint<string, Rpc.Any, RegisteredAction<"internal", DefaultFunctionArgs, Promise<ExitEncoded>>> => {
					const rpc = Rpc.make(tag, {
						payload: mergedPayload,
						success: options.success,
						error: options.error,
					});
					const handlerFn = actionHandler(mergedPayload, options.success, options.error, handler as (payload: Schema.Struct.Type<MergedPayload<PayloadFields>>) => Effect.Effect<Schema.Schema.Type<Success>, Error extends Schema.Schema.AnyNoContext ? Schema.Schema.Type<Error> : never, ConfectActionCtx<ConfectSchema> | MWProvides>);
					const fn = internalActionGeneric({ args: v.any(), handler: handlerFn });
					return { _tag: tag, rpc, fn };
				},
			};
		},
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

export interface AnyRpcModule {
	readonly _def: {
		readonly endpoints: Record<string, RpcEndpoint<string, Rpc.Any, unknown>>;
	};
	readonly rpcs: Record<string, Rpc.Any>;
	readonly handlers: Record<string, unknown>;
	readonly group: unknown;
}

export type InferModuleEndpoints<M extends AnyRpcModule> = M["_def"]["endpoints"];

interface AnyUnbuiltEndpoint {
	readonly __unbuilt: true;
	readonly kind: string;
	readonly payloadFields: Schema.Struct.Fields;
	readonly successSchema: Schema.Schema.AnyNoContext;
	readonly errorSchema: Schema.Schema.AnyNoContext | undefined;
	readonly handler: (payload: never) => Effect.Effect<unknown, unknown, unknown>;
	readonly build: (tag: string) => RpcEndpoint<string, Rpc.Any, unknown>;
}

type BuiltEndpoint<K extends string, U> = U extends UnbuiltRpcEndpoint<
	infer PayloadFields,
	infer Success,
	infer Error,
	infer ConvexFnType
>
	? RpcEndpoint<K, Rpc.Rpc<K, Schema.Struct<PayloadFields>, Success, Error extends Schema.Schema.AnyNoContext ? Error : typeof Schema.Never, never>, ConvexFnType>
	: never;

type BuiltEndpoints<T extends Record<string, AnyUnbuiltEndpoint>> = {
	[K in keyof T & string]: BuiltEndpoint<K, T[K]>;
};

const isUnbuilt = (value: unknown): value is AnyUnbuiltEndpoint =>
	typeof value === "object" && value !== null && "__unbuilt" in value && (value as { __unbuilt: unknown }).__unbuilt === true;

export function makeRpcModule<
	const T extends Record<string, AnyUnbuiltEndpoint>,
>(
	unbuiltEndpoints: T,
): RpcModuleBase<BuiltEndpoints<T>> & { readonly [K in keyof T]: BuiltEndpoint<K & string, T[K]> } {
	const rpcs = {} as Record<string, Rpc.Any>;
	const handlers = {} as Record<string, unknown>;
	const rpcList: Array<Rpc.Any> = [];
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

export { RpcMiddleware };

export type Handler<Tag extends string> = Rpc.Handler<Tag>;

export type ToHandler<R extends Rpc.Any> = Rpc.ToHandler<R>;

export const exitSchema = <R extends Rpc.Any>(rpc: R): Schema.Schema<Rpc.Exit<R>, Rpc.ExitEncoded<R>, Rpc.Context<R>> => {
	return Rpc.exitSchema(rpc);
};

export const WrapperTypeId = Rpc.WrapperTypeId;
export type WrapperTypeId = Rpc.WrapperTypeId;

export type Wrapper<A> = Rpc.Wrapper<A>;

export const isWrapper = Rpc.isWrapper;

export const wrap = Rpc.wrap;

export const fork = Rpc.fork;

export const uninterruptible = Rpc.uninterruptible;

export type HandlersFrom<R extends Rpc.Any> = RpcGroup.HandlersFrom<R>;

export type HandlersContext<R extends Rpc.Any, Handlers> = RpcGroup.HandlersContext<R, Handlers>;

export interface ConfectRpcGroup<R extends Rpc.Any> {
	readonly group: RpcGroup.RpcGroup<R>;
	
	merge<const Groups extends ReadonlyArray<ConfectRpcGroup<Rpc.Any>>>(
		...groups: Groups
	): ConfectRpcGroup<R | ExtractRpcs<Groups[number]>>;
	
	middleware<M extends RpcMiddleware.TagClassAny>(middleware: M): ConfectRpcGroup<Rpc.AddMiddleware<R, M>>;
	
	prefix<const Prefix extends string>(prefix: Prefix): ConfectRpcGroup<Rpc.Prefixed<R, Prefix>>;
	
	toLayer<
		Handlers extends HandlersFrom<R>,
		EX = never,
		RX = never,
	>(
		build: Handlers | Effect.Effect<Handlers, EX, RX>,
	): Layer.Layer<ToHandler<R>, EX, Exclude<RX, import("effect/Scope").Scope> | HandlersContext<R, Handlers>>;
	
	toHandlersContext<
		Handlers extends HandlersFrom<R>,
		EX = never,
		RX = never,
	>(
		build: Handlers | Effect.Effect<Handlers, EX, RX>,
	): Effect.Effect<Context.Context<ToHandler<R>>, EX, RX | HandlersContext<R, Handlers>>;
	
	accessHandler<const Tag extends R["_tag"]>(
		tag: Tag,
	): Effect.Effect<
		(payload: Rpc.Payload<Extract<R, { readonly _tag: Tag }>>, headers: import("@effect/platform/Headers").Headers) => Rpc.ResultFrom<Extract<R, { readonly _tag: Tag }>, never>,
		never,
		Handler<Tag>
	>;
	
	annotate<I, S>(tag: Context.Tag<I, S>, value: S): ConfectRpcGroup<R>;
	
	annotateContext<I>(context: Context.Context<I>): ConfectRpcGroup<R>;
}

type ExtractRpcs<G> = G extends ConfectRpcGroup<infer R> ? R : never;

const makeConfectRpcGroup = <R extends Rpc.Any>(group: RpcGroup.RpcGroup<R>): ConfectRpcGroup<R> => {
	return {
		group,
		
		merge<const Groups extends ReadonlyArray<ConfectRpcGroup<Rpc.Any>>>(
			...groups: Groups
		): ConfectRpcGroup<R | ExtractRpcs<Groups[number]>> {
			const merged = group.merge(...groups.map((g) => g.group));
			return makeConfectRpcGroup(merged) as ConfectRpcGroup<R | ExtractRpcs<Groups[number]>>;
		},
		
		middleware<M extends RpcMiddleware.TagClassAny>(middleware: M): ConfectRpcGroup<Rpc.AddMiddleware<R, M>> {
			return makeConfectRpcGroup(group.middleware(middleware));
		},
		
		prefix<const Prefix extends string>(prefix: Prefix): ConfectRpcGroup<Rpc.Prefixed<R, Prefix>> {
			return makeConfectRpcGroup(group.prefix(prefix));
		},
		
		toLayer<
			Handlers extends HandlersFrom<R>,
			EX = never,
			RX = never,
		>(
			build: Handlers | Effect.Effect<Handlers, EX, RX>,
		) {
			return group.toLayer(build as Handlers | Effect.Effect<Handlers, EX, RX>);
		},
		
		toHandlersContext<
			Handlers extends HandlersFrom<R>,
			EX = never,
			RX = never,
		>(
			build: Handlers | Effect.Effect<Handlers, EX, RX>,
		) {
			return group.toHandlersContext(build as Handlers | Effect.Effect<Handlers, EX, RX>);
		},
		
		accessHandler<const Tag extends R["_tag"]>(
			tag: Tag,
		) {
			return group.accessHandler(tag);
		},
		
		annotate<I, S>(tag: Context.Tag<I, S>, value: S): ConfectRpcGroup<R> {
			return makeConfectRpcGroup(group.annotate(tag, value));
		},
		
		annotateContext<I>(context: Context.Context<I>): ConfectRpcGroup<R> {
			return makeConfectRpcGroup(group.annotateContext(context));
		},
	};
};

export const makeGroup = <const Rpcs extends ReadonlyArray<Rpc.Any>>(
	...rpcs: Rpcs
): ConfectRpcGroup<Rpcs[number]> => {
	return makeConfectRpcGroup(RpcGroup.make(...rpcs));
};
