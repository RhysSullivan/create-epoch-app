import type { Rpc } from "@effect/rpc";
import type {
	FunctionReference,
	RegisteredQuery,
	RegisteredMutation,
	RegisteredAction,
} from "convex/server";
import { Atom, Result } from "@effect-atom/atom";
import { Chunk, Data, Effect, Exit, Option, Stream } from "effect";

import { ConvexClient, ConvexClientLayer } from "../client";
import type { AnyRpcModule, ExitEncoded, RpcEndpoint } from "./server";

export class RpcDefectError extends Data.TaggedError("RpcDefectError")<{
	readonly defect: unknown;
}> {}

type EndpointPayload<E> = E extends RpcEndpoint<infer _Tag, infer R, infer _ConvexFn>
	? Rpc.Payload<R>
	: never;

type EndpointSuccess<E> = E extends RpcEndpoint<infer _Tag, infer R, infer _ConvexFn>
	? Rpc.Success<R>
	: never;

type EndpointError<E> = E extends RpcEndpoint<infer _Tag, infer R, infer _ConvexFn>
	? Rpc.Error<R>
	: never;

type EndpointKind<E> = E extends RpcEndpoint<infer _Tag, infer _R, infer ConvexFn>
	? ConvexFn extends RegisteredQuery<infer _V, infer _A, infer _R>
		? "query"
		: ConvexFn extends RegisteredMutation<infer _V, infer _A, infer _R>
			? "mutation"
			: ConvexFn extends RegisteredAction<infer _V, infer _A, infer _R>
				? "action"
				: never
	: never;

type IsPaginatedResult<T> = T extends {
	page: ReadonlyArray<infer _Item>;
	isDone: boolean;
	continueCursor: string;
}
	? true
	: false;

type ExtractPageItem<T> = T extends {
	page: ReadonlyArray<infer Item>;
	isDone: boolean;
	continueCursor: string;
}
	? Item
	: never;

type IsPaginatedPayload<T> = T extends {
	cursor: string | null;
	numItems: number;
}
	? true
	: false;

export type RpcQueryClient<Payload, Success, Error> = {
	query: (payload: Payload) => Atom.Atom<Result.Result<Success, Error | RpcDefectError>>;
	subscription: (payload: Payload) => Atom.Atom<Result.Result<Success, Error | RpcDefectError>>;
} & (IsPaginatedResult<Success> extends true
	? IsPaginatedPayload<Payload> extends true
		? {
				paginated: (
					numItems: number,
				) => Atom.Writable<
					Atom.PullResult<ExtractPageItem<Success>, Error | RpcDefectError>,
					void
				>;
			}
		: {}
	: {});

export type RpcMutationClient<Payload, Success, Error> = {
	mutate: Atom.AtomResultFn<Payload, Success, Error | RpcDefectError>;
};

export type RpcActionClient<Payload, Success, Error> = {
	call: Atom.AtomResultFn<Payload, Success, Error | RpcDefectError>;
};

type DecorateEndpoint<E, Shared extends Record<string, unknown> = {}> =
	EndpointKind<E> extends "query"
		? RpcQueryClient<
				Omit<EndpointPayload<E>, keyof Shared>,
				EndpointSuccess<E>,
				EndpointError<E>
			>
		: EndpointKind<E> extends "mutation"
			? RpcMutationClient<
					Omit<EndpointPayload<E>, keyof Shared>,
					EndpointSuccess<E>,
					EndpointError<E>
				>
			: EndpointKind<E> extends "action"
				? RpcActionClient<
						Omit<EndpointPayload<E>, keyof Shared>,
						EndpointSuccess<E>,
						EndpointError<E>
					>
				: never;

type EndpointsRecord = Record<string, RpcEndpoint<string, Rpc.Any, unknown>>;

export type RpcModuleClientMethods<TEndpoints extends EndpointsRecord, Shared extends Record<string, unknown> = {}> = {
	readonly [K in keyof TEndpoints]: DecorateEndpoint<TEndpoints[K], Shared>;
};

export interface RpcModuleClientConfig {
	readonly url: string;
}

type ConvexApiModule = Record<string, FunctionReference<"query" | "mutation" | "action">>;

export type RpcModuleClient<
	TModule extends AnyRpcModule,
	Shared extends Record<string, unknown> = {},
> = {
	readonly runtime: Atom.AtomRuntime<ConvexClient>;
} & RpcModuleClientMethods<TModule["_def"]["endpoints"], Shared>;

interface CauseEncoded {
	readonly _tag: "Fail" | "Die" | "Empty";
	readonly error?: unknown;
	readonly defect?: unknown;
}

const decodeExit = (encoded: ExitEncoded): Exit.Exit<unknown, unknown> => {
	if (encoded._tag === "Success") {
		return Exit.succeed(encoded.value);
	}
	const cause = encoded.cause as CauseEncoded | undefined;
	if (!cause) {
		return Exit.fail(new RpcDefectError({ defect: "Unknown error" }));
	}
	if (cause._tag === "Fail") {
		return Exit.fail(cause.error);
	}
	if (cause._tag === "Die") {
		return Exit.fail(new RpcDefectError({ defect: cause.defect }));
	}
	return Exit.fail(new RpcDefectError({ defect: "Empty cause" }));
};

const createQueryAtom = (
	runtime: Atom.AtomRuntime<ConvexClient>,
	convexFn: FunctionReference<"query">,
	payload: unknown,
): Atom.Atom<Result.Result<unknown, unknown>> => {
	return runtime.atom(
		Effect.gen(function* () {
			const client = yield* ConvexClient;
			const encodedExit = yield* client.query(convexFn, payload);
			const exit = decodeExit(encodedExit as ExitEncoded);
			if (Exit.isSuccess(exit)) {
				return exit.value;
			}
			return yield* exit;
		}),
	);
};

const createSubscriptionAtom = (
	runtime: Atom.AtomRuntime<ConvexClient>,
	convexFn: FunctionReference<"query">,
	payload: unknown,
): Atom.Atom<Result.Result<unknown, unknown>> => {
	return runtime.atom(
		Stream.unwrap(
			Effect.gen(function* () {
				const client = yield* ConvexClient;
				return client.subscribe(convexFn, payload).pipe(
					Stream.mapEffect((encodedExit) => {
						const exit = decodeExit(encodedExit as ExitEncoded);
						if (Exit.isSuccess(exit)) {
							return Effect.succeed(exit.value);
						}
						return exit;
					}),
				);
			}),
		),
	);
};

const createMutationFn = (
	runtime: Atom.AtomRuntime<ConvexClient>,
	convexFn: FunctionReference<"mutation">,
	getShared: () => Record<string, unknown>,
): Atom.AtomResultFn<unknown, unknown, unknown> => {
	return runtime.fn<unknown>()(
		Effect.fnUntraced(function* (payload) {
			const client = yield* ConvexClient;
			const fullPayload = { ...getShared(), ...(payload as object) };
			const encodedExit = yield* client.mutation(convexFn, fullPayload);
			const exit = decodeExit(encodedExit as ExitEncoded);
			if (Exit.isSuccess(exit)) {
				return exit.value;
			}
			return yield* exit;
		}),
	);
};

const createActionFn = (
	runtime: Atom.AtomRuntime<ConvexClient>,
	convexFn: FunctionReference<"action">,
	getShared: () => Record<string, unknown>,
): Atom.AtomResultFn<unknown, unknown, unknown> => {
	return runtime.fn<unknown>()(
		Effect.fnUntraced(function* (payload) {
			const client = yield* ConvexClient;
			const fullPayload = { ...getShared(), ...(payload as object) };
			const encodedExit = yield* client.action(convexFn, fullPayload);
			const exit = decodeExit(encodedExit as ExitEncoded);
			if (Exit.isSuccess(exit)) {
				return exit.value;
			}
			return yield* exit;
		}),
	);
};

interface PaginatedResult<T> {
	page: ReadonlyArray<T>;
	isDone: boolean;
	continueCursor: string;
}

const createPaginatedAtom = (
	runtime: Atom.AtomRuntime<ConvexClient>,
	convexFn: FunctionReference<"query">,
	getShared: () => Record<string, unknown>,
	numItems: number,
): Atom.Writable<Atom.PullResult<unknown, unknown>, void> => {
	return runtime.pull(
		Stream.paginateChunkEffect(null as string | null, (cursor) =>
			Effect.gen(function* () {
				const client = yield* ConvexClient;
				const fullPayload = {
					...getShared(),
					cursor,
					numItems,
				};
				const encodedExit = yield* client.query(convexFn, fullPayload);
				const exit = decodeExit(encodedExit as ExitEncoded);
				if (Exit.isFailure(exit)) {
					return yield* Effect.failCause(exit.cause);
				}
				const result = exit.value as PaginatedResult<unknown>;
				const nextCursor = result.isDone
					? Option.none<string | null>()
					: Option.some(result.continueCursor);

				return [Chunk.fromIterable(result.page), nextCursor] as const;
			}),
		),
	);
};

const noop = () => {};

export function createRpcClient<
	TModule extends AnyRpcModule,
	Shared extends Record<string, unknown> = {},
>(
	convexApi: ConvexApiModule,
	config: RpcModuleClientConfig,
	getShared: () => Shared = () => ({}) as Shared,
): RpcModuleClient<TModule, Shared> {
	const runtime = Atom.runtime(ConvexClientLayer(config.url));

	const queryFamilies = new Map<string, (payload: unknown) => Atom.Atom<Result.Result<unknown, unknown>>>();
	const subscriptionFamilies = new Map<string, (payload: unknown) => Atom.Atom<Result.Result<unknown, unknown>>>();
	const mutationFns = new Map<string, Atom.AtomResultFn<unknown, unknown, unknown>>();
	const actionFns = new Map<string, Atom.AtomResultFn<unknown, unknown, unknown>>();
	const paginatedFamilies = new Map<string, (numItems: number) => Atom.Writable<Atom.PullResult<unknown, unknown>, void>>();

	const getQueryFamily = (tag: string) => {
		let family = queryFamilies.get(tag);
		if (!family) {
			const convexFn = convexApi[tag] as FunctionReference<"query">;
			family = Atom.family((p: unknown) => {
				const fullPayload = { ...getShared(), ...(p as object) };
				return createQueryAtom(runtime, convexFn, fullPayload);
			});
			queryFamilies.set(tag, family);
		}
		return family;
	};

	const getSubscriptionFamily = (tag: string) => {
		let family = subscriptionFamilies.get(tag);
		if (!family) {
			const convexFn = convexApi[tag] as FunctionReference<"query">;
			family = Atom.family((p: unknown) => {
				const fullPayload = { ...getShared(), ...(p as object) };
				return createSubscriptionAtom(runtime, convexFn, fullPayload);
			});
			subscriptionFamilies.set(tag, family);
		}
		return family;
	};

	const getMutationFn = (tag: string) => {
		let fn = mutationFns.get(tag);
		if (!fn) {
			const convexFn = convexApi[tag] as FunctionReference<"mutation">;
			fn = createMutationFn(runtime, convexFn, getShared);
			mutationFns.set(tag, fn);
		}
		return fn;
	};

	const getActionFn = (tag: string) => {
		let fn = actionFns.get(tag);
		if (!fn) {
			const convexFn = convexApi[tag] as FunctionReference<"action">;
			fn = createActionFn(runtime, convexFn, getShared);
			actionFns.set(tag, fn);
		}
		return fn;
	};

	const getPaginatedFamily = (tag: string) => {
		let family = paginatedFamilies.get(tag);
		if (!family) {
			const convexFn = convexApi[tag] as FunctionReference<"query">;
			family = Atom.family((numItems: number) => createPaginatedAtom(runtime, convexFn, getShared, numItems));
			paginatedFamilies.set(tag, family);
		}
		return family;
	};

	const endpointProxyCache = new Map<string, unknown>();

	const proxy = new Proxy(noop, {
		get(_target, prop) {
			if (prop === "runtime") {
				return runtime;
			}
			if (prop === "then") {
				return undefined;
			}
			if (typeof prop !== "string") {
				return undefined;
			}

			let endpointProxy = endpointProxyCache.get(prop);
			if (!endpointProxy) {
				endpointProxy = {
					query: (payload: unknown) => getQueryFamily(prop)(payload),
					subscription: (payload: unknown) => getSubscriptionFamily(prop)(payload),
					mutate: getMutationFn(prop),
					call: getActionFn(prop),
					paginated: (numItems: number) => getPaginatedFamily(prop)(numItems),
				};
				endpointProxyCache.set(prop, endpointProxy);
			}
			return endpointProxy;
		},
	});

	return proxy as unknown as RpcModuleClient<TModule, Shared>;
}
