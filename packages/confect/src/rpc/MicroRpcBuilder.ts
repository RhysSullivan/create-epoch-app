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
import type { PropertyValidators, ObjectType } from "convex/values";
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

export interface MicroRpcEndpoint<
	Tag extends string,
	Args extends PropertyValidators,
	Success,
	Error,
	ConvexFn,
> {
	readonly _tag: Tag;
	readonly args: Args;
	readonly fn: ConvexFn;
}

export interface UnbuiltMicroRpcEndpoint<
	Args extends PropertyValidators,
	Success,
	Error,
	ConvexFnType,
> {
	readonly __unbuilt: true;
	readonly kind: string;
	readonly args: Args;
	readonly handler: (args: DefaultFunctionArgs) => Micro.Micro<Success, Error, unknown>;
	readonly build: (tag: string) => MicroRpcEndpoint<string, Args, Success, Error, ConvexFnType>;
}

export const createMicroRpcFactory = () => {
	return {
		query: <
			Args extends PropertyValidators,
			Success,
			Error = never,
		>(
			args: Args,
			handler: (
				args: ObjectType<Args>,
			) => Micro.Micro<Success, Error, MicroQueryCtx>,
		): UnbuiltMicroRpcEndpoint<
			Args,
			Success,
			Error,
			RegisteredQuery<"public", ObjectType<Args>, Promise<MicroExit<Success, Error>>>
		> => ({
			__unbuilt: true as const,
			kind: "query" as const,
			args,
			handler: handler as (args: DefaultFunctionArgs) => Micro.Micro<Success, Error, unknown>,
			build: (tag: string) => {
				const fn = queryGeneric({
					args,
					returns: microExitValidator,
					handler: async (
						ctx: GenericQueryCtx<GenericDataModel>,
						typedArgs: ObjectType<Args>,
					): Promise<MicroExit<Success, Error>> => {
						const effect = handler(typedArgs).pipe(
							Micro.provideService(MicroQueryCtx, ctx),
						);
						return runMicroHandler(effect);
					},
				});
				return { _tag: tag, args, fn };
			},
		}),

		mutation: <
			Args extends PropertyValidators,
			Success,
			Error = never,
		>(
			args: Args,
			handler: (
				args: ObjectType<Args>,
			) => Micro.Micro<Success, Error, MicroMutationCtx>,
		): UnbuiltMicroRpcEndpoint<
			Args,
			Success,
			Error,
			RegisteredMutation<"public", ObjectType<Args>, Promise<MicroExit<Success, Error>>>
		> => ({
			__unbuilt: true as const,
			kind: "mutation" as const,
			args,
			handler: handler as (args: DefaultFunctionArgs) => Micro.Micro<Success, Error, unknown>,
			build: (tag: string) => {
				const fn = mutationGeneric({
					args,
					returns: microExitValidator,
					handler: async (
						ctx: GenericMutationCtx<GenericDataModel>,
						typedArgs: ObjectType<Args>,
					): Promise<MicroExit<Success, Error>> => {
						const effect = handler(typedArgs).pipe(
							Micro.provideService(MicroMutationCtx, ctx),
						);
						return runMicroHandler(effect);
					},
				});
				return { _tag: tag, args, fn };
			},
		}),

		action: <
			Args extends PropertyValidators,
			Success,
			Error = never,
		>(
			args: Args,
			handler: (
				args: ObjectType<Args>,
			) => Micro.Micro<Success, Error, MicroActionCtx>,
		): UnbuiltMicroRpcEndpoint<
			Args,
			Success,
			Error,
			RegisteredAction<"public", ObjectType<Args>, Promise<MicroExit<Success, Error>>>
		> => ({
			__unbuilt: true as const,
			kind: "action" as const,
			args,
			handler: handler as (args: DefaultFunctionArgs) => Micro.Micro<Success, Error, unknown>,
			build: (tag: string) => {
				const fn = actionGeneric({
					args,
					returns: microExitValidator,
					handler: async (
						ctx: GenericActionCtx<GenericDataModel>,
						typedArgs: ObjectType<Args>,
					): Promise<MicroExit<Success, Error>> => {
						const effect = handler(typedArgs).pipe(
							Micro.provideService(MicroActionCtx, ctx),
						);
						return runMicroHandler(effect);
					},
				});
				return { _tag: tag, args, fn };
			},
		}),

		internalQuery: <
			Args extends PropertyValidators,
			Success,
			Error = never,
		>(
			args: Args,
			handler: (
				args: ObjectType<Args>,
			) => Micro.Micro<Success, Error, MicroQueryCtx>,
		): UnbuiltMicroRpcEndpoint<
			Args,
			Success,
			Error,
			RegisteredQuery<"internal", ObjectType<Args>, Promise<MicroExit<Success, Error>>>
		> => ({
			__unbuilt: true as const,
			kind: "internalQuery" as const,
			args,
			handler: handler as (args: DefaultFunctionArgs) => Micro.Micro<Success, Error, unknown>,
			build: (tag: string) => {
				const fn = internalQueryGeneric({
					args,
					returns: microExitValidator,
					handler: async (
						ctx: GenericQueryCtx<GenericDataModel>,
						typedArgs: ObjectType<Args>,
					): Promise<MicroExit<Success, Error>> => {
						const effect = handler(typedArgs).pipe(
							Micro.provideService(MicroQueryCtx, ctx),
						);
						return runMicroHandler(effect);
					},
				});
				return { _tag: tag, args, fn };
			},
		}),

		internalMutation: <
			Args extends PropertyValidators,
			Success,
			Error = never,
		>(
			args: Args,
			handler: (
				args: ObjectType<Args>,
			) => Micro.Micro<Success, Error, MicroMutationCtx>,
		): UnbuiltMicroRpcEndpoint<
			Args,
			Success,
			Error,
			RegisteredMutation<"internal", ObjectType<Args>, Promise<MicroExit<Success, Error>>>
		> => ({
			__unbuilt: true as const,
			kind: "internalMutation" as const,
			args,
			handler: handler as (args: DefaultFunctionArgs) => Micro.Micro<Success, Error, unknown>,
			build: (tag: string) => {
				const fn = internalMutationGeneric({
					args,
					returns: microExitValidator,
					handler: async (
						ctx: GenericMutationCtx<GenericDataModel>,
						typedArgs: ObjectType<Args>,
					): Promise<MicroExit<Success, Error>> => {
						const effect = handler(typedArgs).pipe(
							Micro.provideService(MicroMutationCtx, ctx),
						);
						return runMicroHandler(effect);
					},
				});
				return { _tag: tag, args, fn };
			},
		}),

		internalAction: <
			Args extends PropertyValidators,
			Success,
			Error = never,
		>(
			args: Args,
			handler: (
				args: ObjectType<Args>,
			) => Micro.Micro<Success, Error, MicroActionCtx>,
		): UnbuiltMicroRpcEndpoint<
			Args,
			Success,
			Error,
			RegisteredAction<"internal", ObjectType<Args>, Promise<MicroExit<Success, Error>>>
		> => ({
			__unbuilt: true as const,
			kind: "internalAction" as const,
			args,
			handler: handler as (args: DefaultFunctionArgs) => Micro.Micro<Success, Error, unknown>,
			build: (tag: string) => {
				const fn = internalActionGeneric({
					args,
					returns: microExitValidator,
					handler: async (
						ctx: GenericActionCtx<GenericDataModel>,
						typedArgs: ObjectType<Args>,
					): Promise<MicroExit<Success, Error>> => {
						const effect = handler(typedArgs).pipe(
							Micro.provideService(MicroActionCtx, ctx),
						);
						return runMicroHandler(effect);
					},
				});
				return { _tag: tag, args, fn };
			},
		}),
	};
};

type AnyUnbuiltMicroEndpoint = UnbuiltMicroRpcEndpoint<PropertyValidators, unknown, unknown, unknown>;

type BuiltMicroEndpoint<K extends string, U> = U extends UnbuiltMicroRpcEndpoint<
	infer Args,
	infer Success,
	infer Error,
	infer ConvexFnType
>
	? MicroRpcEndpoint<K, Args, Success, Error, ConvexFnType>
	: never;

type BuiltMicroEndpoints<T extends Record<string, AnyUnbuiltMicroEndpoint>> = {
	[K in keyof T & string]: BuiltMicroEndpoint<K, T[K]>;
};

export type InferMicroFn<E> = E extends MicroRpcEndpoint<
	string,
	PropertyValidators,
	unknown,
	unknown,
	infer ConvexFn
>
	? ConvexFn
	: never;

interface MicroRpcModuleBase<
	Endpoints extends Record<
		string,
		MicroRpcEndpoint<string, PropertyValidators, unknown, unknown, unknown>
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
		MicroRpcEndpoint<string, PropertyValidators, unknown, unknown, unknown>
	>,
> = MicroRpcModuleBase<Endpoints> & Endpoints;

export type AnyMicroRpcModule = MicroRpcModuleBase<
	Record<string, MicroRpcEndpoint<string, PropertyValidators, unknown, unknown, unknown>>
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
		MicroRpcEndpoint<string, PropertyValidators, unknown, unknown, unknown>
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
