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
import { Context, Effect, Exit, Cause, pipe, Schema, Chunk } from "effect";

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
import { schemaToArgsValidator } from "../validators";

type TableSchemas<Tables extends GenericConfectSchema> = {
	[TableName in TableNamesInSchema<Tables>]: Schema.Schema<
		DocumentFromTable<Tables, TableName>,
		EncodedDocumentFromTable<Tables, TableName>
	>;
};

const SystemFieldsSchema = Schema.Struct({
	_id: Schema.String,
	_creationTime: Schema.Number,
});

const buildTableSchemas = <Tables extends GenericConfectSchema>(
	tables: Tables,
): TableSchemas<Tables> => {
	const result: Record<string, Schema.Schema.AnyNoContext> = {};
	for (const [tableName, tableDef] of Object.entries(tables)) {
		const userSchema = (tableDef as { tableSchema: Schema.Schema.AnyNoContext }).tableSchema;
		result[tableName] = Schema.extend(SystemFieldsSchema, userSchema);
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

interface ExitEncoded {
	readonly _tag: "Success" | "Failure";
	readonly value?: unknown;
	readonly cause?: unknown;
}

const encodeExit = <A, E>(
	exit: Exit.Exit<A, E>,
	encodeSuccess: (a: A) => unknown,
	encodeError: (e: E) => unknown,
): ExitEncoded => {
	if (Exit.isSuccess(exit)) {
		return { _tag: "Success", value: encodeSuccess(exit.value) };
	}
	const failureOption = Cause.failureOption(exit.cause);
	if (failureOption._tag === "Some") {
		return {
			_tag: "Failure",
			cause: {
				_tag: "Fail",
				error: encodeError(failureOption.value),
			},
		};
	}
	const defectsChunk = Cause.defects(exit.cause);
	const defectArray = Chunk.toArray(defectsChunk);
	if (defectArray.length > 0) {
		return {
			_tag: "Failure",
			cause: {
				_tag: "Die",
				defect: defectArray[0],
			},
		};
	}
	return {
		_tag: "Failure",
		cause: {
			_tag: "Empty",
		},
	};
};

export const createRpcFactory = <
	ConfectSchema extends GenericConfectSchema,
	BasePayload extends Schema.Struct.Fields = {},
	Middlewares extends ReadonlyArray<MiddlewareEntry> = [],
>(
	config: RpcFactoryConfig<ConfectSchema, BasePayload, Middlewares>,
) => {
	const tableSchemas = buildTableSchemas(config.schema.tables);
	const basePayload = config.basePayload ?? ({} as BasePayload);
	const middlewares = config.middlewares ?? [];

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
			const middlewareTag = middleware.tag as RpcMiddleware.TagClassAny & {
				provides?: Context.Tag<unknown, unknown>;
			};
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
	) => async (rawCtx: GenericQueryCtx<GenericDataModel> | GenericMutationCtx<GenericDataModel> | GenericActionCtx<GenericDataModel>, args: DefaultFunctionArgs): Promise<ExitEncoded> => {
		const payloadSchema = Schema.Struct(payloadFields) as unknown as Schema.Schema<Schema.Struct.Type<PayloadFields>, Schema.Struct.Encoded<PayloadFields>, never>;
		const effect = pipe(
			Effect.succeed(args),
			Effect.flatMap((rawArgs) => Schema.decode(payloadSchema)(rawArgs as Schema.Struct.Encoded<PayloadFields>)),
			Effect.orDie,
			Effect.flatMap((decodedArgs) => {
				const handlerEffect = handler(decodedArgs);
				const withMiddleware = applyMiddleware(handlerEffect, decodedArgs);
				return Effect.provideService(
					withMiddleware as Effect.Effect<Schema.Schema.Type<Success>, unknown, Ctx>,
					ctxTag,
					makeCtxFn(rawCtx),
				);
			}),
		);

		const exit = await Effect.runPromiseExit(effect);
		return encodeExit(
			exit,
			(a) => Schema.encodeSync(successSchema)(a),
			(e) => errorSchema ? Schema.encodeSync(errorSchema)(e as Schema.Schema.Type<typeof errorSchema>) : e,
		);
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
					const payloadSchema = Schema.Struct(mergedPayload) as unknown as Schema.Schema.AnyNoContext;
					const argsValidator = schemaToArgsValidator(payloadSchema);
					const rpc = Rpc.make(tag, {
						payload: mergedPayload,
						success: options.success,
						error: options.error,
					});
					const handlerFn = queryHandler(mergedPayload, options.success, options.error, handler as (payload: Schema.Struct.Type<MergedPayload<PayloadFields>>) => Effect.Effect<Schema.Schema.Type<Success>, Error extends Schema.Schema.AnyNoContext ? Schema.Schema.Type<Error> : never, ConfectQueryCtx<ConfectSchema> | MWProvides>);
					const fn = queryGeneric({ args: argsValidator, handler: handlerFn });
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
					const payloadSchema = Schema.Struct(mergedPayload) as unknown as Schema.Schema.AnyNoContext;
					const argsValidator = schemaToArgsValidator(payloadSchema);
					const rpc = Rpc.make(tag, {
						payload: mergedPayload,
						success: options.success,
						error: options.error,
					});
					const handlerFn = mutationHandler(mergedPayload, options.success, options.error, handler as (payload: Schema.Struct.Type<MergedPayload<PayloadFields>>) => Effect.Effect<Schema.Schema.Type<Success>, Error extends Schema.Schema.AnyNoContext ? Schema.Schema.Type<Error> : never, ConfectMutationCtx<ConfectSchema> | MWProvides>);
					const fn = mutationGeneric({ args: argsValidator, handler: handlerFn });
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
					const payloadSchema = Schema.Struct(mergedPayload) as unknown as Schema.Schema.AnyNoContext;
					const argsValidator = schemaToArgsValidator(payloadSchema);
					const rpc = Rpc.make(tag, {
						payload: mergedPayload,
						success: options.success,
						error: options.error,
					});
					const handlerFn = actionHandler(mergedPayload, options.success, options.error, handler as (payload: Schema.Struct.Type<MergedPayload<PayloadFields>>) => Effect.Effect<Schema.Schema.Type<Success>, Error extends Schema.Schema.AnyNoContext ? Schema.Schema.Type<Error> : never, ConfectActionCtx<ConfectSchema> | MWProvides>);
					const fn = actionGeneric({ args: argsValidator, handler: handlerFn });
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
					const payloadSchema = Schema.Struct(mergedPayload) as unknown as Schema.Schema.AnyNoContext;
					const argsValidator = schemaToArgsValidator(payloadSchema);
					const rpc = Rpc.make(tag, {
						payload: mergedPayload,
						success: options.success,
						error: options.error,
					});
					const handlerFn = queryHandler(mergedPayload, options.success, options.error, handler as (payload: Schema.Struct.Type<MergedPayload<PayloadFields>>) => Effect.Effect<Schema.Schema.Type<Success>, Error extends Schema.Schema.AnyNoContext ? Schema.Schema.Type<Error> : never, ConfectQueryCtx<ConfectSchema> | MWProvides>);
					const fn = internalQueryGeneric({ args: argsValidator, handler: handlerFn });
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
					const payloadSchema = Schema.Struct(mergedPayload) as unknown as Schema.Schema.AnyNoContext;
					const argsValidator = schemaToArgsValidator(payloadSchema);
					const rpc = Rpc.make(tag, {
						payload: mergedPayload,
						success: options.success,
						error: options.error,
					});
					const handlerFn = mutationHandler(mergedPayload, options.success, options.error, handler as (payload: Schema.Struct.Type<MergedPayload<PayloadFields>>) => Effect.Effect<Schema.Schema.Type<Success>, Error extends Schema.Schema.AnyNoContext ? Schema.Schema.Type<Error> : never, ConfectMutationCtx<ConfectSchema> | MWProvides>);
					const fn = internalMutationGeneric({ args: argsValidator, handler: handlerFn });
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
					const payloadSchema = Schema.Struct(mergedPayload) as unknown as Schema.Schema.AnyNoContext;
					const argsValidator = schemaToArgsValidator(payloadSchema);
					const rpc = Rpc.make(tag, {
						payload: mergedPayload,
						success: options.success,
						error: options.error,
					});
					const handlerFn = actionHandler(mergedPayload, options.success, options.error, handler as (payload: Schema.Struct.Type<MergedPayload<PayloadFields>>) => Effect.Effect<Schema.Schema.Type<Success>, Error extends Schema.Schema.AnyNoContext ? Schema.Schema.Type<Error> : never, ConfectActionCtx<ConfectSchema> | MWProvides>);
					const fn = internalActionGeneric({ args: argsValidator, handler: handlerFn });
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
export type { ExitEncoded };
