import type { Rpc } from "@effect/rpc";
import { Atom, Result } from "@effect-atom/atom";
import type {
	FunctionReference,
	RegisteredQuery,
	RegisteredMutation,
	RegisteredAction,
} from "convex/server";
import { Cause, Effect, Exit, Stream } from "effect";
import { ConvexClient, ConvexClientLayer } from "../client/convex-client";
import type { RpcEndpoint } from "./RpcBuilder";

interface EncodedExit {
	readonly _tag: "Success" | "Failure";
	readonly value?: unknown;
	readonly cause?: unknown;
}

const decodeExit = (encoded: EncodedExit): Exit.Exit<unknown, unknown> => {
	if (encoded._tag === "Success") {
		return Exit.succeed(encoded.value);
	}
	return Exit.failCause(encoded.cause as Cause.Cause<unknown>);
};

export interface RpcModuleClientConfig {
	readonly url: string;
}

type ConvexApiModule = Record<
	string,
	FunctionReference<"query" | "mutation" | "action">
>;

type EndpointResult<E> = E extends RpcEndpoint<
	infer _Tag,
	infer R,
	infer _ConvexFn
>
	? Result.Result<Rpc.Success<R>, Rpc.Error<R>>
	: never;

type EndpointPayload<E> = E extends RpcEndpoint<
	infer _Tag,
	infer R,
	infer _ConvexFn
>
	? Rpc.Payload<R>
	: never;

type EndpointSuccess<E> = E extends RpcEndpoint<
	infer _Tag,
	infer R,
	infer _ConvexFn
>
	? Rpc.Success<R>
	: never;

type EndpointError<E> = E extends RpcEndpoint<
	infer _Tag,
	infer R,
	infer _ConvexFn
>
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

type DecorateEndpoint<E, Shared extends Record<string, unknown> = {}> =
	EndpointKind<E> extends "query"
		? {
				query: (
					payload: Omit<EndpointPayload<E>, keyof Shared>,
				) => Atom.Atom<EndpointResult<E>>;
				subscription: (
					payload: Omit<EndpointPayload<E>, keyof Shared>,
				) => Atom.Atom<EndpointResult<E>>;
			}
		: EndpointKind<E> extends "mutation"
			? {
					mutate: Atom.AtomResultFn<
						Omit<EndpointPayload<E>, keyof Shared>,
						EndpointSuccess<E>,
						EndpointError<E>
					>;
				}
			: EndpointKind<E> extends "action"
				? {
						call: Atom.AtomResultFn<
							Omit<EndpointPayload<E>, keyof Shared>,
							EndpointSuccess<E>,
							EndpointError<E>
						>;
					}
				: never;

type EndpointsRecord = Record<string, RpcEndpoint<string, Rpc.Any, unknown>>;

export type RpcModuleClient<
	TEndpoints extends EndpointsRecord,
	Shared extends Record<string, unknown> = {},
> = {
	readonly runtime: Atom.AtomRuntime<ConvexClient>;
} & {
	readonly [K in keyof TEndpoints]: DecorateEndpoint<TEndpoints[K], Shared>;
};

const createQueryAtom = (
	runtime: Atom.AtomRuntime<ConvexClient>,
	convexFn: FunctionReference<"query">,
	payload: unknown,
): Atom.Atom<Result.Result<unknown, unknown>> => {
	return runtime.atom(
		Effect.gen(function* () {
			const client = yield* ConvexClient;
			const encodedExit = yield* client.query(
				convexFn,
				payload as Record<string, unknown>,
			);
			const exit = decodeExit(encodedExit as EncodedExit);
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
				return client
					.subscribe(convexFn, payload as Record<string, unknown>)
					.pipe(
						Stream.mapEffect((encodedExit) => {
							const exit = decodeExit(encodedExit as EncodedExit);
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
			const encodedExit = yield* client.mutation(
				convexFn,
				fullPayload as Record<string, unknown>,
			);
			const exit = decodeExit(encodedExit as EncodedExit);
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
			const encodedExit = yield* client.action(
				convexFn,
				fullPayload as Record<string, unknown>,
			);
			const exit = decodeExit(encodedExit as EncodedExit);
			if (Exit.isSuccess(exit)) {
				return exit.value;
			}
			return yield* exit;
		}),
	);
};

const noop = () => {};

export const makeClient = <
	TEndpoints extends EndpointsRecord,
	Shared extends Record<string, unknown> = {},
>(
	convexApi: ConvexApiModule,
	config: RpcModuleClientConfig,
	getShared: () => Shared = () => ({}) as Shared,
): RpcModuleClient<TEndpoints, Shared> => {
	const runtime = Atom.runtime(ConvexClientLayer(config.url));

	const queryFamilies = new Map<
		string,
		(payload: unknown) => Atom.Atom<Result.Result<unknown, unknown>>
	>();
	const subscriptionFamilies = new Map<
		string,
		(payload: unknown) => Atom.Atom<Result.Result<unknown, unknown>>
	>();
	const mutationFns = new Map<
		string,
		Atom.AtomResultFn<unknown, unknown, unknown>
	>();
	const actionFns = new Map<
		string,
		Atom.AtomResultFn<unknown, unknown, unknown>
	>();

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
					subscription: (payload: unknown) =>
						getSubscriptionFamily(prop)(payload),
					mutate: getMutationFn(prop),
					call: getActionFn(prop),
				};
				endpointProxyCache.set(prop, endpointProxy);
			}
			return endpointProxy;
		},
	});

	return proxy as unknown as RpcModuleClient<TEndpoints, Shared>;
};

export const makeClientWithShared = <
	TEndpoints extends EndpointsRecord,
	Shared extends Record<string, unknown>,
>(
	convexApi: ConvexApiModule,
	config: RpcModuleClientConfig,
	getShared: () => Shared,
): RpcModuleClient<TEndpoints, Shared> => {
	return makeClient<TEndpoints, Shared>(convexApi, config, getShared);
};

type ModuleWithEndpoints = {
	readonly _def: { readonly endpoints: EndpointsRecord };
};

type DecoratedEndpoints<M, Shared extends Record<string, unknown>> = {
	readonly [K in keyof M as K extends "_def" | "rpcs" | "handlers" | "group" ? never : K]: M[K] extends RpcEndpoint<infer _T, infer _R, infer _C>
		? DecorateEndpoint<M[K], Shared>
		: never;
};

export type RpcModuleClientFromModule<
	M extends ModuleWithEndpoints,
	Shared extends Record<string, unknown> = {},
> = {
	readonly runtime: Atom.AtomRuntime<ConvexClient>;
} & DecoratedEndpoints<M, Shared>;

export function createClient<
	M extends ModuleWithEndpoints,
	Shared extends Record<string, unknown> = {},
>(
	convexApi: ConvexApiModule,
	config: RpcModuleClientConfig,
	getShared: () => Shared = () => ({}) as Shared,
): RpcModuleClientFromModule<M, Shared> {
	return makeClient<M["_def"]["endpoints"], Shared>(
		convexApi,
		config,
		getShared,
	) as unknown as RpcModuleClientFromModule<M, Shared>;
}
