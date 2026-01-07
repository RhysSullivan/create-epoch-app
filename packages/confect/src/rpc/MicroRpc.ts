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
import type {
	PropertyValidators,
	ObjectType,
	Validator,
} from "convex/values";
import * as Context from "effect/Context";
import * as Micro from "effect/Micro";

export type MicroExit<A, E> =
	| { readonly _tag: "Success"; readonly value: A }
	| { readonly _tag: "Failure"; readonly error: E }
	| { readonly _tag: "Die"; readonly defect: unknown };

const encodeMicroExit = <A, E>(
	exit: Micro.MicroExit<A, E>,
): MicroExit<A, E> => {
	if (exit._tag === "Success") {
		return { _tag: "Success", value: exit.value };
	}
	const cause = exit.cause;
	if (cause._tag === "Fail") {
		return { _tag: "Failure", error: cause.error };
	}
	if (cause._tag === "Die") {
		return { _tag: "Die", defect: cause.defect };
	}
	return { _tag: "Die", defect: "Interrupted" };
};

const runMicroHandler = async <A, E>(
	effect: Micro.Micro<A, E, never>,
): Promise<MicroExit<A, E>> => {
	const exit = await Micro.runPromiseExit(effect);
	return encodeMicroExit(exit);
};

const microExitValidator = v.object({
	_tag: v.union(
		v.literal("Success"),
		v.literal("Failure"),
		v.literal("Die"),
	),
	value: v.optional(v.any()),
	error: v.optional(v.any()),
	defect: v.optional(v.any()),
});

export class MicroQueryCtx extends Context.Tag("@confect/MicroQueryCtx")<
	MicroQueryCtx,
	GenericQueryCtx<GenericDataModel>
>() {}

export class MicroMutationCtx extends Context.Tag("@confect/MicroMutationCtx")<
	MicroMutationCtx,
	GenericMutationCtx<GenericDataModel>
>() {}

export class MicroActionCtx extends Context.Tag("@confect/MicroActionCtx")<
	MicroActionCtx,
	GenericActionCtx<GenericDataModel>
>() {}

export const TaggedError = <
	Tag extends string,
	Fields extends PropertyValidators = {},
>(
	tag: Tag,
	fields?: Fields,
): {
	readonly _tag: Tag;
	readonly fields: Fields;
	new (props: ObjectType<Fields>): ObjectType<Fields> & { readonly _tag: Tag };
	readonly validator: Validator<
		ObjectType<Fields> & { readonly _tag: Tag },
		"required",
		string
	>;
} => {
	const actualFields = fields ?? ({} as Fields);

	class TaggedErrorClass {
		readonly _tag = tag;
		constructor(props: ObjectType<Fields>) {
			Object.assign(this, props);
		}

		static readonly _tag = tag;
		static readonly fields = actualFields;
		static readonly validator = v.object({
			_tag: v.literal(tag),
			...actualFields,
		});
	}

	return TaggedErrorClass as unknown as {
		readonly _tag: Tag;
		readonly fields: Fields;
		new (props: ObjectType<Fields>): ObjectType<Fields> & { readonly _tag: Tag };
		readonly validator: Validator<
			ObjectType<Fields> & { readonly _tag: Tag },
			"required",
			string
		>;
	};
};

export type InferTaggedError<T> = T extends {
	new (props: infer _Props): infer Instance;
}
	? Instance
	: never;

export interface MicroRpcEndpoint<
	Tag extends string,
	Args extends PropertyValidators,
	Success,
	Error,
	ConvexFn,
	Kind extends "query" | "mutation" | "action",
> {
	readonly _tag: Tag;
	readonly _kind: Kind;
	readonly args: Args;
	readonly fn: ConvexFn;
	readonly __success: Success;
	readonly __error: Error;
}

export interface UnbuiltMicroRpcEndpoint<
	Args extends PropertyValidators,
	Success,
	Error,
	ConvexFnType,
	Kind extends "query" | "mutation" | "action",
> {
	readonly __unbuilt: true;
	readonly kind: Kind | `internal${Capitalize<Kind>}`;
	readonly args: Args;
	readonly handler: (args: DefaultFunctionArgs) => Micro.Micro<Success, Error, unknown>;
	readonly build: (tag: string) => MicroRpcEndpoint<string, Args, Success, Error, ConvexFnType, Kind>;
}

interface MicroMiddlewareOptions<Payload> {
	readonly payload: Payload;
}

export interface MicroMiddlewareFn<Service, Failure> {
	(options: MicroMiddlewareOptions<unknown>): Micro.Micro<Service, Failure, never>;
}

export interface MicroMiddlewareTag<
	Tag extends string,
	ServiceTag,
	Service,
	Failure,
> {
	readonly _tag: Tag;
	readonly provides: ServiceTag;
	readonly of: (
		impl: MicroMiddlewareFn<Service, Failure>,
	) => MicroMiddlewareImpl<Tag, ServiceTag, Service, Failure>;
}

export interface MicroMiddlewareImpl<
	Tag extends string,
	ServiceTag,
	Service,
	Failure,
> extends MicroMiddlewareFn<Service, Failure> {
	readonly _tag: Tag;
	readonly provides: ServiceTag;
}

type TagService<T> = T extends Context.Tag<infer _I, infer S> ? S : never;
type TagIdentifier<T> = T extends Context.Tag<infer I, infer _S> ? I : never;

export const MicroMiddleware = {
	Tag: <
		TagName extends string,
		ServiceTag extends { Service: unknown },
		Failure = never,
	>(
		tag: TagName,
		config: {
			readonly provides: ServiceTag;
			readonly failure?: Failure;
		},
	): MicroMiddlewareTag<TagName, ServiceTag, ServiceTag["Service"], Failure> => ({
		_tag: tag,
		provides: config.provides,
		of: (impl) => {
			const fn = impl as MicroMiddlewareImpl<TagName, ServiceTag, ServiceTag["Service"], Failure>;
			Object.defineProperty(fn, "_tag", { value: tag, writable: false });
			Object.defineProperty(fn, "provides", {
				value: config.provides,
				writable: false,
			});
			return fn;
		},
	}),
};

export interface MicroMiddlewareEntry<
	TagName extends string = string,
	ServiceTag = unknown,
	Service = unknown,
	Failure = unknown,
> {
	readonly tag: MicroMiddlewareTag<TagName, ServiceTag, Service, Failure>;
	readonly impl: MicroMiddlewareImpl<TagName, ServiceTag, Service, Failure>;
}

type AnyMiddlewareEntryShape = {
	readonly tag: { readonly _tag: string; readonly provides: unknown };
	readonly impl: (options: MicroMiddlewareOptions<unknown>) => Micro.Micro<unknown, unknown, never>;
};

type TagIdentity<T> = T extends Context.Tag<infer I, infer _S> ? I : T;

type ExtractMiddlewareServiceTag<M> = M extends { tag: { provides: infer ST } }
	? TagIdentity<ST>
	: never;

type ExtractMiddlewareFailure<M> = M extends { impl: (options: MicroMiddlewareOptions<unknown>) => Micro.Micro<unknown, infer F, never> }
	? F
	: never;

type MiddlewaresProvides<Middlewares extends ReadonlyArray<AnyMiddlewareEntryShape>> =
	ExtractMiddlewareServiceTag<Middlewares[number]>;

type MiddlewaresFailure<Middlewares extends ReadonlyArray<AnyMiddlewareEntryShape>> =
	ExtractMiddlewareFailure<Middlewares[number]>;

export interface MicroRpcFactoryConfig<
	BaseArgs extends PropertyValidators = {},
	Middlewares extends ReadonlyArray<AnyMiddlewareEntryShape> = [],
> {
	readonly baseArgs?: BaseArgs;
	readonly middlewares?: Middlewares;
}

export const createMicroRpcFactory = <
	BaseArgs extends PropertyValidators = {},
	Middlewares extends ReadonlyArray<AnyMiddlewareEntryShape> = [],
>(
	config?: MicroRpcFactoryConfig<BaseArgs, Middlewares>,
) => {
	const baseArgs = config?.baseArgs ?? ({} as BaseArgs);
	const middlewares = config?.middlewares ?? ([] as unknown as Middlewares);

	type MWProvides = MiddlewaresProvides<Middlewares>;
	type MWFailure = MiddlewaresFailure<Middlewares>;

	const applyMiddleware = <A, E, R>(
		effect: Micro.Micro<A, E, R>,
		payload: unknown,
	): Micro.Micro<A, E | MWFailure, Exclude<R, MWProvides>> => {
		if (middlewares.length === 0) {
			return effect as Micro.Micro<A, E | MWFailure, Exclude<R, MWProvides>>;
		}

		const options: MicroMiddlewareOptions<unknown> = { payload };

		let result = effect as Micro.Micro<A, E | MWFailure, Exclude<R, MWProvides>>;

		for (const entry of middlewares) {
			const impl = entry.impl;
			const provides = entry.tag.provides;

			if (provides !== undefined) {
				result = Micro.provideServiceEffect(
					result,
					provides as unknown as Context.Tag<unknown, unknown>,
					impl(options) as Micro.Micro<unknown, MWFailure, never>,
				) as Micro.Micro<A, E | MWFailure, Exclude<R, MWProvides>>;
			} else {
				result = Micro.flatMap(
					impl(options) as Micro.Micro<void, MWFailure, never>,
					() => result,
				) as Micro.Micro<A, E | MWFailure, Exclude<R, MWProvides>>;
			}
		}

		return result;
	};

	type MergedArgs<Extra extends PropertyValidators> = BaseArgs & Extra;
	type AllowedQueryReqs = MicroQueryCtx | MWProvides;
	type AllowedMutationReqs = MicroMutationCtx | MWProvides;
	type AllowedActionReqs = MicroActionCtx | MWProvides;

	return {
		query: <
			Args extends PropertyValidators,
			Success,
			Error = never,
		>(
			args: Args,
			handler: (
				args: ObjectType<MergedArgs<Args>>,
			) => Micro.Micro<Success, Error, AllowedQueryReqs>,
		): UnbuiltMicroRpcEndpoint<
			MergedArgs<Args>,
			Success,
			Error | MWFailure,
			RegisteredQuery<"public", ObjectType<MergedArgs<Args>>, Promise<MicroExit<Success, Error | MWFailure>>>,
			"query"
		> => {
			const mergedArgs = { ...baseArgs, ...args } as MergedArgs<Args>;
			return {
				__unbuilt: true as const,
				kind: "query" as const,
				args: mergedArgs,
				handler: handler as (args: DefaultFunctionArgs) => Micro.Micro<Success, Error, unknown>,
				build: (tag: string) => {
					const fn = queryGeneric({
						args: mergedArgs,
						returns: microExitValidator,
						handler: (async (
							ctx: GenericQueryCtx<GenericDataModel>,
							typedArgs: ObjectType<MergedArgs<Args>>,
						): Promise<MicroExit<Success, Error | MWFailure>> => {
							const effect = handler(typedArgs);
							const withMiddleware = applyMiddleware(effect, typedArgs);
							const provided = Micro.provideService(
								withMiddleware as Micro.Micro<Success, Error | MWFailure, MicroQueryCtx>,
								MicroQueryCtx,
								ctx,
							);
							return runMicroHandler(provided);
						}) as never,
					});
					return {
						_tag: tag,
						_kind: "query" as const,
						args: mergedArgs,
						fn,
						__success: undefined as unknown as Success,
						__error: undefined as unknown as Error | MWFailure,
					};
				},
			};
		},

		mutation: <
			Args extends PropertyValidators,
			Success,
			Error = never,
		>(
			args: Args,
			handler: (
				args: ObjectType<MergedArgs<Args>>,
			) => Micro.Micro<Success, Error, AllowedMutationReqs>,
		): UnbuiltMicroRpcEndpoint<
			MergedArgs<Args>,
			Success,
			Error | MWFailure,
			RegisteredMutation<"public", ObjectType<MergedArgs<Args>>, Promise<MicroExit<Success, Error | MWFailure>>>,
			"mutation"
		> => {
			const mergedArgs = { ...baseArgs, ...args } as MergedArgs<Args>;
			return {
				__unbuilt: true as const,
				kind: "mutation" as const,
				args: mergedArgs,
				handler: handler as (args: DefaultFunctionArgs) => Micro.Micro<Success, Error, unknown>,
				build: (tag: string) => {
					const fn = mutationGeneric({
						args: mergedArgs,
						returns: microExitValidator,
						handler: (async (
							ctx: GenericMutationCtx<GenericDataModel>,
							typedArgs: ObjectType<MergedArgs<Args>>,
						): Promise<MicroExit<Success, Error | MWFailure>> => {
							const effect = handler(typedArgs);
							const withMiddleware = applyMiddleware(effect, typedArgs);
							const provided = Micro.provideService(
								withMiddleware as Micro.Micro<Success, Error | MWFailure, MicroMutationCtx>,
								MicroMutationCtx,
								ctx,
							);
							return runMicroHandler(provided);
						}) as never,
					});
					return {
						_tag: tag,
						_kind: "mutation" as const,
						args: mergedArgs,
						fn,
						__success: undefined as unknown as Success,
						__error: undefined as unknown as Error | MWFailure,
					};
				},
			};
		},

		action: <
			Args extends PropertyValidators,
			Success,
			Error = never,
		>(
			args: Args,
			handler: (
				args: ObjectType<MergedArgs<Args>>,
			) => Micro.Micro<Success, Error, AllowedActionReqs>,
		): UnbuiltMicroRpcEndpoint<
			MergedArgs<Args>,
			Success,
			Error | MWFailure,
			RegisteredAction<"public", ObjectType<MergedArgs<Args>>, Promise<MicroExit<Success, Error | MWFailure>>>,
			"action"
		> => {
			const mergedArgs = { ...baseArgs, ...args } as MergedArgs<Args>;
			return {
				__unbuilt: true as const,
				kind: "action" as const,
				args: mergedArgs,
				handler: handler as (args: DefaultFunctionArgs) => Micro.Micro<Success, Error, unknown>,
				build: (tag: string) => {
					const fn = actionGeneric({
						args: mergedArgs,
						returns: microExitValidator,
						handler: (async (
							ctx: GenericActionCtx<GenericDataModel>,
							typedArgs: ObjectType<MergedArgs<Args>>,
						): Promise<MicroExit<Success, Error | MWFailure>> => {
							const effect = handler(typedArgs);
							const withMiddleware = applyMiddleware(effect, typedArgs);
							const provided = Micro.provideService(
								withMiddleware as Micro.Micro<Success, Error | MWFailure, MicroActionCtx>,
								MicroActionCtx,
								ctx,
							);
							return runMicroHandler(provided);
						}) as never,
					});
					return {
						_tag: tag,
						_kind: "action" as const,
						args: mergedArgs,
						fn,
						__success: undefined as unknown as Success,
						__error: undefined as unknown as Error | MWFailure,
					};
				},
			};
		},

		internalQuery: <
			Args extends PropertyValidators,
			Success,
			Error = never,
		>(
			args: Args,
			handler: (
				args: ObjectType<MergedArgs<Args>>,
			) => Micro.Micro<Success, Error, AllowedQueryReqs>,
		): UnbuiltMicroRpcEndpoint<
			MergedArgs<Args>,
			Success,
			Error | MWFailure,
			RegisteredQuery<"internal", ObjectType<MergedArgs<Args>>, Promise<MicroExit<Success, Error | MWFailure>>>,
			"query"
		> => {
			const mergedArgs = { ...baseArgs, ...args } as MergedArgs<Args>;
			return {
				__unbuilt: true as const,
				kind: "internalQuery" as const,
				args: mergedArgs,
				handler: handler as (args: DefaultFunctionArgs) => Micro.Micro<Success, Error, unknown>,
				build: (tag: string) => {
					const fn = internalQueryGeneric({
						args: mergedArgs,
						returns: microExitValidator,
						handler: (async (
							ctx: GenericQueryCtx<GenericDataModel>,
							typedArgs: ObjectType<MergedArgs<Args>>,
						): Promise<MicroExit<Success, Error | MWFailure>> => {
							const effect = handler(typedArgs);
							const withMiddleware = applyMiddleware(effect, typedArgs);
							const provided = Micro.provideService(
								withMiddleware as Micro.Micro<Success, Error | MWFailure, MicroQueryCtx>,
								MicroQueryCtx,
								ctx,
							);
							return runMicroHandler(provided);
						}) as never,
					});
					return {
						_tag: tag,
						_kind: "query" as const,
						args: mergedArgs,
						fn,
						__success: undefined as unknown as Success,
						__error: undefined as unknown as Error | MWFailure,
					};
				},
			};
		},

		internalMutation: <
			Args extends PropertyValidators,
			Success,
			Error = never,
		>(
			args: Args,
			handler: (
				args: ObjectType<MergedArgs<Args>>,
			) => Micro.Micro<Success, Error, AllowedMutationReqs>,
		): UnbuiltMicroRpcEndpoint<
			MergedArgs<Args>,
			Success,
			Error | MWFailure,
			RegisteredMutation<"internal", ObjectType<MergedArgs<Args>>, Promise<MicroExit<Success, Error | MWFailure>>>,
			"mutation"
		> => {
			const mergedArgs = { ...baseArgs, ...args } as MergedArgs<Args>;
			return {
				__unbuilt: true as const,
				kind: "internalMutation" as const,
				args: mergedArgs,
				handler: handler as (args: DefaultFunctionArgs) => Micro.Micro<Success, Error, unknown>,
				build: (tag: string) => {
					const fn = internalMutationGeneric({
						args: mergedArgs,
						returns: microExitValidator,
						handler: (async (
							ctx: GenericMutationCtx<GenericDataModel>,
							typedArgs: ObjectType<MergedArgs<Args>>,
						): Promise<MicroExit<Success, Error | MWFailure>> => {
							const effect = handler(typedArgs);
							const withMiddleware = applyMiddleware(effect, typedArgs);
							const provided = Micro.provideService(
								withMiddleware as Micro.Micro<Success, Error | MWFailure, MicroMutationCtx>,
								MicroMutationCtx,
								ctx,
							);
							return runMicroHandler(provided);
						}) as never,
					});
					return {
						_tag: tag,
						_kind: "mutation" as const,
						args: mergedArgs,
						fn,
						__success: undefined as unknown as Success,
						__error: undefined as unknown as Error | MWFailure,
					};
				},
			};
		},

		internalAction: <
			Args extends PropertyValidators,
			Success,
			Error = never,
		>(
			args: Args,
			handler: (
				args: ObjectType<MergedArgs<Args>>,
			) => Micro.Micro<Success, Error, AllowedActionReqs>,
		): UnbuiltMicroRpcEndpoint<
			MergedArgs<Args>,
			Success,
			Error | MWFailure,
			RegisteredAction<"internal", ObjectType<MergedArgs<Args>>, Promise<MicroExit<Success, Error | MWFailure>>>,
			"action"
		> => {
			const mergedArgs = { ...baseArgs, ...args } as MergedArgs<Args>;
			return {
				__unbuilt: true as const,
				kind: "internalAction" as const,
				args: mergedArgs,
				handler: handler as (args: DefaultFunctionArgs) => Micro.Micro<Success, Error, unknown>,
				build: (tag: string) => {
					const fn = internalActionGeneric({
						args: mergedArgs,
						returns: microExitValidator,
						handler: (async (
							ctx: GenericActionCtx<GenericDataModel>,
							typedArgs: ObjectType<MergedArgs<Args>>,
						): Promise<MicroExit<Success, Error | MWFailure>> => {
							const effect = handler(typedArgs);
							const withMiddleware = applyMiddleware(effect, typedArgs);
							const provided = Micro.provideService(
								withMiddleware as Micro.Micro<Success, Error | MWFailure, MicroActionCtx>,
								MicroActionCtx,
								ctx,
							);
							return runMicroHandler(provided);
						}) as never,
					});
					return {
						_tag: tag,
						_kind: "action" as const,
						args: mergedArgs,
						fn,
						__success: undefined as unknown as Success,
						__error: undefined as unknown as Error | MWFailure,
					};
				},
			};
		},
	};
};

type AnyUnbuiltMicroEndpoint = UnbuiltMicroRpcEndpoint<
	PropertyValidators,
	unknown,
	unknown,
	unknown,
	"query" | "mutation" | "action"
>;

type BuiltMicroEndpoint<K extends string, U> = U extends UnbuiltMicroRpcEndpoint<
	infer Args,
	infer Success,
	infer Error,
	infer ConvexFnType,
	infer Kind
>
	? MicroRpcEndpoint<K, Args, Success, Error, ConvexFnType, Kind>
	: never;

type BuiltMicroEndpoints<T extends Record<string, AnyUnbuiltMicroEndpoint>> = {
	[K in keyof T & string]: BuiltMicroEndpoint<K, T[K]>;
};

export type InferMicroFn<E> = E extends MicroRpcEndpoint<
	string,
	PropertyValidators,
	unknown,
	unknown,
	infer ConvexFn,
	"query" | "mutation" | "action"
>
	? ConvexFn
	: never;

export type InferMicroSuccess<E> = E extends MicroRpcEndpoint<
	string,
	PropertyValidators,
	infer Success,
	unknown,
	unknown,
	"query" | "mutation" | "action"
>
	? Success
	: never;

export type InferMicroError<E> = E extends MicroRpcEndpoint<
	string,
	PropertyValidators,
	unknown,
	infer Error,
	unknown,
	"query" | "mutation" | "action"
>
	? Error
	: never;

export type InferMicroArgs<E> = E extends MicroRpcEndpoint<
	string,
	infer Args,
	unknown,
	unknown,
	unknown,
	"query" | "mutation" | "action"
>
	? ObjectType<Args>
	: never;

export type InferMicroKind<E> = E extends MicroRpcEndpoint<
	string,
	PropertyValidators,
	unknown,
	unknown,
	unknown,
	infer Kind
>
	? Kind
	: never;

interface MicroRpcModuleBase<
	Endpoints extends Record<
		string,
		MicroRpcEndpoint<string, PropertyValidators, unknown, unknown, unknown, "query" | "mutation" | "action">
	>,
> {
	readonly _def: {
		readonly endpoints: Endpoints;
	};
	readonly handlers: { [K in keyof Endpoints]: InferMicroFn<Endpoints[K]> };
}

export type MicroRpcModule<
	Endpoints extends Record<
		string,
		MicroRpcEndpoint<string, PropertyValidators, unknown, unknown, unknown, "query" | "mutation" | "action">
	>,
> = MicroRpcModuleBase<Endpoints> & Endpoints;

export type AnyMicroRpcModule = MicroRpcModuleBase<
	Record<string, MicroRpcEndpoint<string, PropertyValidators, unknown, unknown, unknown, "query" | "mutation" | "action">>
>;

const isUnbuiltMicro = (value: unknown): value is AnyUnbuiltMicroEndpoint =>
	typeof value === "object" &&
	value !== null &&
	"__unbuilt" in value &&
	value.__unbuilt === true;

export function makeMicroRpcModule<
	const T extends Record<string, AnyUnbuiltMicroEndpoint>,
>(
	unbuiltEndpoints: T,
): MicroRpcModuleBase<BuiltMicroEndpoints<T>> & {
	readonly [K in keyof T]: BuiltMicroEndpoint<K & string, T[K]>;
} {
	const handlers = {} as Record<string, unknown>;
	const builtEndpoints = {} as Record<
		string,
		MicroRpcEndpoint<string, PropertyValidators, unknown, unknown, unknown, "query" | "mutation" | "action">
	>;

	for (const key of Object.keys(unbuiltEndpoints)) {
		const unbuilt = unbuiltEndpoints[key]!;
		if (!isUnbuiltMicro(unbuilt)) {
			throw new Error(`Expected unbuilt endpoint for key "${key}"`);
		}
		const endpoint = unbuilt.build(key);
		builtEndpoints[key] = endpoint;
		handlers[key] = endpoint.fn;
	}

	type Built = BuiltMicroEndpoints<T>;
	const module = {
		_def: { endpoints: builtEndpoints },
		handlers: handlers as { [K in keyof Built]: InferMicroFn<Built[K]> },
	};

	return Object.assign(module, builtEndpoints) as MicroRpcModuleBase<Built> & {
		readonly [K in keyof T]: BuiltMicroEndpoint<K & string, T[K]>;
	};
}

export const microRpc = createMicroRpcFactory();

export { v, Micro, Context };
