import { Atom, Result } from "@effect-atom/atom";
import type { FunctionReference } from "convex/server";
import { Effect, Exit, Schema, Stream } from "effect";
import { ConvexClient, ConvexClientLayer } from "../client/convex-client";
import type * as Rpc from "./Rpc";
import type { RpcGroup, RpcsOf } from "./RpcGroup";

export interface RpcClientConfig {
	readonly url: string;
}

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

type RpcMethod<R extends Rpc.Any> = R extends Rpc.Rpc<
	infer _Tag,
	infer Type,
	infer _Payload,
	infer _Success,
	infer _Error
>
	? Type extends "query"
		? QueryMethod<R>
		: Type extends "mutation"
			? MutationMethod<R>
			: Type extends "action"
				? ActionMethod<R>
				: never
	: never;

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

type RpcMethodWithShared<R extends Rpc.Any, Shared extends Record<string, unknown>> = R extends Rpc.Rpc<
	infer _Tag,
	infer Type,
	infer _Payload,
	infer _Success,
	infer _Error
>
	? Type extends "query"
		? QueryMethodWithShared<R, Shared>
		: Type extends "mutation"
			? MutationMethodWithShared<R, Shared>
			: Type extends "action"
				? ActionMethodWithShared<R, Shared>
				: never
	: never;

type ConvexApiModule = Record<
	string,
	FunctionReference<"query"> | FunctionReference<"mutation"> | FunctionReference<"action">
>;

export type RpcClient<
	Group extends RpcGroup<Rpc.Any>,
	Api extends ConvexApiModule = ConvexApiModule,
> = {
	readonly runtime: Atom.AtomRuntime<ConvexClient>;
} & {
	readonly [K in keyof Api & RpcsOf<Group>["_tag"]]: RpcMethod<
		Extract<RpcsOf<Group>, { _tag: K }>
	>;
};

export type RpcClientWithShared<
	Group extends RpcGroup<Rpc.Any>,
	Api extends ConvexApiModule,
	Shared extends Record<string, unknown>,
> = {
	readonly runtime: Atom.AtomRuntime<ConvexClient>;
} & {
	readonly [K in keyof Api & RpcsOf<Group>["_tag"]]: RpcMethodWithShared<
		Extract<RpcsOf<Group>, { _tag: K }>,
		Shared
	>;
};

export const make = <Group extends RpcGroup<Rpc.Any>, Api extends ConvexApiModule>(
	group: Group,
	convexApi: Api,
	config: RpcClientConfig,
): RpcClient<Group, Api> => {
	const runtime = Atom.runtime(ConvexClientLayer(config.url));

	const cache = new Map<string, unknown>();

	const decodeExit = (
		rpc: Rpc.Any,
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

	const createQueryMethod = (rpc: Rpc.Any, apiRef: FunctionReference<"query">) => {
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

	const createMutationMethod = (rpc: Rpc.Any, apiRef: FunctionReference<"mutation">) => {
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

	const createActionMethod = (rpc: Rpc.Any, apiRef: FunctionReference<"action">) => {
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

	for (const [tag, rpc] of group.rpcs) {
		const apiRef = convexApi[tag];
		if (!apiRef) {
			throw new Error(`Missing API reference for RPC: ${tag}`);
		}

		if (!cache.has(tag)) {
			if (rpc._type === "query") {
				cache.set(tag, createQueryMethod(rpc, apiRef as FunctionReference<"query">));
			} else if (rpc._type === "mutation") {
				cache.set(tag, createMutationMethod(rpc, apiRef as FunctionReference<"mutation">));
			} else {
				cache.set(tag, createActionMethod(rpc, apiRef as FunctionReference<"action">));
			}
		}

		client[tag] = cache.get(tag);
	}

	return client as RpcClient<Group, Api>;
};

export const makeWithShared = <
	Group extends RpcGroup<Rpc.Any>,
	Api extends ConvexApiModule,
	Shared extends Record<string, unknown>,
>(
	group: Group,
	convexApi: Api,
	config: RpcClientConfig,
	getShared: () => Shared,
): RpcClientWithShared<Group, Api, Shared> => {
	const runtime = Atom.runtime(ConvexClientLayer(config.url));

	const decodeExit = (
		rpc: Rpc.Any,
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

	const createQueryMethod = (rpc: Rpc.Any, apiRef: FunctionReference<"query">) => {
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

	const createMutationMethod = (rpc: Rpc.Any, apiRef: FunctionReference<"mutation">) => {
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

	const createActionMethod = (rpc: Rpc.Any, apiRef: FunctionReference<"action">) => {
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

	for (const [tag, rpc] of group.rpcs) {
		const apiRef = convexApi[tag];
		if (!apiRef) {
			throw new Error(`Missing API reference for RPC: ${tag}`);
		}

		if (rpc._type === "query") {
			client[tag] = createQueryMethod(rpc, apiRef as FunctionReference<"query">);
		} else if (rpc._type === "mutation") {
			client[tag] = createMutationMethod(rpc, apiRef as FunctionReference<"mutation">);
		} else {
			client[tag] = createActionMethod(rpc, apiRef as FunctionReference<"action">);
		}
	}

	return client as RpcClientWithShared<Group, Api, Shared>;
};
