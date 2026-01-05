import { Rpc, RpcGroup } from "@effect/rpc";
import { Atom, Result } from "@effect-atom/atom";
import type { FunctionReference } from "convex/server";
import { Context, Effect, Exit, Option, Schema, Stream } from "effect";
import { ConvexClient, ConvexClientLayer } from "../client/convex-client";
import { ConvexFunctionType, type FunctionType } from "../convex/ConvexFunctionType";

export interface RpcClientConfig {
	readonly url: string;
}

type AnyRpcWithProps = Rpc.AnyWithProps;

const getFunctionType = (rpc: AnyRpcWithProps): FunctionType =>
	Option.getOrElse(
		Context.getOption(rpc.annotations, ConvexFunctionType),
		() => "query" as FunctionType,
	);

type QueryMethod<R extends Rpc.Any> = (
	payload: Rpc.Payload<R>,
) => Atom.Atom<Result.Result<Rpc.Success<R>, Rpc.Error<R>>>;

type MutationMethod<R extends Rpc.Any> = Atom.AtomResultFn<
	Rpc.Payload<R>,
	Rpc.Success<R>,
	Rpc.Error<R>
>;

type ActionMethod<R extends Rpc.Any> = Atom.AtomResultFn<
	Rpc.Payload<R>,
	Rpc.Success<R>,
	Rpc.Error<R>
>;

type QueryMethodWithShared<R extends Rpc.Any, Shared extends Record<string, unknown>> = (
	payload: Omit<Rpc.Payload<R>, keyof Shared>,
) => Atom.Atom<Result.Result<Rpc.Success<R>, Rpc.Error<R>>>;

type MutationMethodWithShared<R extends Rpc.Any, Shared extends Record<string, unknown>> = Atom.AtomResultFn<
	Omit<Rpc.Payload<R>, keyof Shared>,
	Rpc.Success<R>,
	Rpc.Error<R>
>;

type ActionMethodWithShared<R extends Rpc.Any, Shared extends Record<string, unknown>> = Atom.AtomResultFn<
	Omit<Rpc.Payload<R>, keyof Shared>,
	Rpc.Success<R>,
	Rpc.Error<R>
>;

type ConvexApiModule = Record<
	string,
	FunctionReference<"query"> | FunctionReference<"mutation"> | FunctionReference<"action">
>;

type ExtractFunctionType<F> = F extends { _type: infer T } ? T : never;

type RpcMethodForFunctionType<R extends Rpc.Any, FnType extends "query" | "mutation" | "action"> =
	FnType extends "query" ? QueryMethod<R> :
	FnType extends "mutation" ? MutationMethod<R> :
	FnType extends "action" ? ActionMethod<R> :
	never;

type RpcMethodWithSharedForFunctionType<
	R extends Rpc.Any,
	Shared extends Record<string, unknown>,
	FnType extends "query" | "mutation" | "action"
> =
	FnType extends "query" ? QueryMethodWithShared<R, Shared> :
	FnType extends "mutation" ? MutationMethodWithShared<R, Shared> :
	FnType extends "action" ? ActionMethodWithShared<R, Shared> :
	never;

export type RpcClient<
	Rpcs extends Rpc.Any,
	Api extends ConvexApiModule = ConvexApiModule,
> = {
	readonly runtime: Atom.AtomRuntime<ConvexClient>;
} & {
	readonly [K in keyof Api & Rpcs["_tag"]]: RpcMethodForFunctionType<
		Extract<Rpcs, { _tag: K }>,
		ExtractFunctionType<Api[K]>
	>;
};

export type RpcClientFromGroup<
	Group extends RpcGroup.Any,
	Api extends ConvexApiModule = ConvexApiModule,
> = RpcClient<RpcGroup.Rpcs<Group>, Api>;

export type RpcClientWithShared<
	Rpcs extends Rpc.Any,
	Api extends ConvexApiModule,
	Shared extends Record<string, unknown>,
> = {
	readonly runtime: Atom.AtomRuntime<ConvexClient>;
} & {
	readonly [K in keyof Api as K extends Rpcs["_tag"] ? K : never]: RpcMethodWithSharedForFunctionType<
		Extract<Rpcs, { _tag: K }>,
		Shared,
		ExtractFunctionType<Api[K]>
	>;
};

export type RpcClientWithSharedFromGroup<
	Group extends RpcGroup.Any,
	Api extends ConvexApiModule,
	Shared extends Record<string, unknown>,
> = RpcClientWithShared<RpcGroup.Rpcs<Group>, Api, Shared>;

export const make = <Rpcs extends Rpc.Any, Api extends ConvexApiModule>(
	group: RpcGroup.RpcGroup<Rpcs>,
	convexApi: Api,
	config: RpcClientConfig,
): RpcClient<Rpcs, Api> => {
	const runtime = Atom.runtime(ConvexClientLayer(config.url));

	const cache = new Map<string, unknown>();

	const decodeExit = (
		rpc: AnyRpcWithProps,
		encodedExit: Schema.ExitEncoded<unknown, unknown, unknown>,
	): Effect.Effect<unknown, unknown, never> => {
		const exitSchema = Schema.Exit({
			success: rpc.successSchema as Schema.Schema<unknown, unknown>,
			failure: rpc.errorSchema as Schema.Schema<unknown, unknown>,
			defect: Schema.Defect,
		});

		return Effect.gen(function* () {
			const exit = yield* Schema.decode(exitSchema)(encodedExit).pipe(Effect.orDie);
			if (Exit.isSuccess(exit)) {
				return exit.value;
			}
			return yield* exit;
		});
	};

	const createQueryMethod = (rpc: AnyRpcWithProps, apiRef: FunctionReference<"query">) => {
		const subscriptionCache = new Map<string, Atom.Atom<Result.Result<unknown, unknown>>>();

		return (payload: unknown) => {
			const key = JSON.stringify(payload);
			if (!subscriptionCache.has(key)) {
				const stream = Stream.unwrap(
					Effect.gen(function* () {
						const client = yield* ConvexClient;
						const encodedPayload = yield* Schema.encode(
							rpc.payloadSchema as Schema.Schema<unknown, unknown>,
						)(payload).pipe(Effect.orDie);
						return Stream.mapEffect(
							client.subscribe(apiRef, encodedPayload) as Stream.Stream<
								Schema.ExitEncoded<unknown, unknown, unknown>,
								never,
								never
							>,
							(result) => decodeExit(rpc, result),
						);
					}),
				);
				subscriptionCache.set(
					key,
					runtime.atom(stream as Stream.Stream<unknown, unknown, ConvexClient>),
				);
			}
			return subscriptionCache.get(key)!;
		};
	};

	const createMutationMethod = (rpc: AnyRpcWithProps, apiRef: FunctionReference<"mutation">) => {
		return runtime.fn(
			Effect.fnUntraced(function* (payload: unknown) {
				const client = yield* ConvexClient;
				const encodedPayload = yield* Schema.encode(
					rpc.payloadSchema as Schema.Schema<unknown, unknown>,
				)(payload).pipe(Effect.orDie);
				const result: Schema.ExitEncoded<unknown, unknown, unknown> = yield* client.mutation(
					apiRef,
					encodedPayload,
				);
				return yield* decodeExit(rpc, result);
			}),
		);
	};

	const createActionMethod = (rpc: AnyRpcWithProps, apiRef: FunctionReference<"action">) => {
		return runtime.fn(
			Effect.fnUntraced(function* (payload: unknown) {
				const client = yield* ConvexClient;
				const encodedPayload = yield* Schema.encode(
					rpc.payloadSchema as Schema.Schema<unknown, unknown>,
				)(payload).pipe(Effect.orDie);
				const result: Schema.ExitEncoded<unknown, unknown, unknown> = yield* client.action(
					apiRef,
					encodedPayload,
				);
				return yield* decodeExit(rpc, result);
			}),
		);
	};

	const client: Record<string, unknown> = { runtime };

	for (const [tag, rpc] of group.requests) {
		const rpcWithProps = rpc as never as AnyRpcWithProps;
		const apiRef = convexApi[tag];
		if (!apiRef) {
			throw new Error(`Missing API reference for RPC: ${tag}`);
		}

		if (!cache.has(tag)) {
			const functionType = getFunctionType(rpcWithProps);
			if (functionType === "query") {
				cache.set(tag, createQueryMethod(rpcWithProps, apiRef as FunctionReference<"query">));
			} else if (functionType === "mutation") {
				cache.set(tag, createMutationMethod(rpcWithProps, apiRef as FunctionReference<"mutation">));
			} else {
				cache.set(tag, createActionMethod(rpcWithProps, apiRef as FunctionReference<"action">));
			}
		}

		client[tag] = cache.get(tag);
	}

	return client as RpcClient<Rpcs, Api>;
};

export const makeWithShared = <
	Rpcs extends Rpc.Any,
	Api extends ConvexApiModule,
	Shared extends Record<string, unknown>,
>(
	group: RpcGroup.RpcGroup<Rpcs>,
	convexApi: Api,
	config: RpcClientConfig,
	getShared: () => Shared,
): RpcClientWithShared<Rpcs, Api, Shared> => {
	const runtime = Atom.runtime(ConvexClientLayer(config.url));

	const decodeExit = (
		rpc: AnyRpcWithProps,
		encodedExit: Schema.ExitEncoded<unknown, unknown, unknown>,
	): Effect.Effect<unknown, unknown, never> => {
		const exitSchema = Schema.Exit({
			success: rpc.successSchema as Schema.Schema<unknown, unknown>,
			failure: rpc.errorSchema as Schema.Schema<unknown, unknown>,
			defect: Schema.Defect,
		});

		return Effect.gen(function* () {
			const exit = yield* Schema.decode(exitSchema)(encodedExit).pipe(Effect.orDie);
			if (Exit.isSuccess(exit)) {
				return exit.value;
			}
			return yield* exit;
		});
	};

	const createQueryMethod = (rpc: AnyRpcWithProps, apiRef: FunctionReference<"query">) => {
		const subscriptionCache = new Map<string, Atom.Atom<Result.Result<unknown, unknown>>>();

		return (partialPayload: unknown) => {
			const payload = { ...getShared(), ...(partialPayload as Record<string, unknown>) };
			const key = JSON.stringify(payload);
			if (!subscriptionCache.has(key)) {
				const stream = Stream.unwrap(
					Effect.gen(function* () {
						const client = yield* ConvexClient;
						const encodedPayload = yield* Schema.encode(
							rpc.payloadSchema as Schema.Schema<unknown, unknown>,
						)(payload).pipe(Effect.orDie);
						return Stream.mapEffect(
							client.subscribe(apiRef, encodedPayload) as Stream.Stream<
								Schema.ExitEncoded<unknown, unknown, unknown>,
								never,
								never
							>,
							(result) => decodeExit(rpc, result),
						);
					}),
				);
				subscriptionCache.set(
					key,
					runtime.atom(stream as Stream.Stream<unknown, unknown, ConvexClient>),
				);
			}
			return subscriptionCache.get(key)!;
		};
	};

	const createMutationMethod = (rpc: AnyRpcWithProps, apiRef: FunctionReference<"mutation">) => {
		return runtime.fn(
			Effect.fnUntraced(function* (partialPayload: unknown) {
				const payload = { ...getShared(), ...(partialPayload as Record<string, unknown>) };
				const client = yield* ConvexClient;
				const encodedPayload = yield* Schema.encode(
					rpc.payloadSchema as Schema.Schema<unknown, unknown>,
				)(payload).pipe(Effect.orDie);
				const result: Schema.ExitEncoded<unknown, unknown, unknown> = yield* client.mutation(
					apiRef,
					encodedPayload,
				);
				return yield* decodeExit(rpc, result);
			}),
		);
	};

	const createActionMethod = (rpc: AnyRpcWithProps, apiRef: FunctionReference<"action">) => {
		return runtime.fn(
			Effect.fnUntraced(function* (partialPayload: unknown) {
				const payload = { ...getShared(), ...(partialPayload as Record<string, unknown>) };
				const client = yield* ConvexClient;
				const encodedPayload = yield* Schema.encode(
					rpc.payloadSchema as Schema.Schema<unknown, unknown>,
				)(payload).pipe(Effect.orDie);
				const result: Schema.ExitEncoded<unknown, unknown, unknown> = yield* client.action(
					apiRef,
					encodedPayload,
				);
				return yield* decodeExit(rpc, result);
			}),
		);
	};

	const client: Record<string, unknown> = { runtime };

	for (const [tag, rpc] of group.requests) {
		const rpcWithProps = rpc as never as AnyRpcWithProps;
		const apiRef = convexApi[tag];
		if (!apiRef) {
			throw new Error(`Missing API reference for RPC: ${tag}`);
		}

		const functionType = getFunctionType(rpcWithProps);
		if (functionType === "query") {
			client[tag] = createQueryMethod(rpcWithProps, apiRef as FunctionReference<"query">);
		} else if (functionType === "mutation") {
			client[tag] = createMutationMethod(rpcWithProps, apiRef as FunctionReference<"mutation">);
		} else {
			client[tag] = createActionMethod(rpcWithProps, apiRef as FunctionReference<"action">);
		}
	}

	return client as RpcClientWithShared<Rpcs, Api, Shared>;
};
