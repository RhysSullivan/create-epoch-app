import { Atom, Result } from "@effect-atom/atom";
import type { FunctionReference } from "convex/server";
import { Chunk, Effect, Exit, Option, Stream } from "effect";
import { ConvexClient, ConvexClientLayer } from "../client/convex-client";
import type {
	MicroRpcEndpoint,
	MicroExit,
	InferMicroSuccess,
	InferMicroError,
	InferMicroArgs,
	InferMicroKind,
} from "./MicroRpc";
import type { PropertyValidators } from "convex/values";

const decodeMicroExit = <A, E>(
	encoded: MicroExit<A, E>,
): Exit.Exit<A, E> => {
	if (encoded._tag === "Success") {
		return Exit.succeed(encoded.value);
	}
	if (encoded._tag === "Failure") {
		return Exit.fail(encoded.error);
	}
	return Exit.die(encoded.defect);
};

export interface MicroRpcModuleClientConfig {
	readonly url: string;
}

type ConvexApiModule = Record<
	string,
	FunctionReference<"query" | "mutation" | "action">
>;

type MicroEndpointResult<E> = E extends MicroRpcEndpoint<
	string,
	PropertyValidators,
	infer Success,
	infer Error,
	unknown,
	"query" | "mutation" | "action"
>
	? Result.Result<Success, Error>
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

type DecorateMicroEndpoint<E, Shared extends Record<string, unknown> = {}> =
	InferMicroKind<E> extends "query"
		? IsPaginatedResult<InferMicroSuccess<E>> extends true
			? IsPaginatedPayload<InferMicroArgs<E>> extends true
				? {
						query: (
							payload: Omit<InferMicroArgs<E>, keyof Shared>,
						) => Atom.Atom<MicroEndpointResult<E>>;
						subscription: (
							payload: Omit<InferMicroArgs<E>, keyof Shared>,
						) => Atom.Atom<MicroEndpointResult<E>>;
						paginated: (
							numItems: number,
						) => Atom.Writable<
							Atom.PullResult<ExtractPageItem<InferMicroSuccess<E>>, InferMicroError<E>>,
							void
						>;
					}
				: {
						query: (
							payload: Omit<InferMicroArgs<E>, keyof Shared>,
						) => Atom.Atom<MicroEndpointResult<E>>;
						subscription: (
							payload: Omit<InferMicroArgs<E>, keyof Shared>,
						) => Atom.Atom<MicroEndpointResult<E>>;
					}
			: {
					query: (
						payload: Omit<InferMicroArgs<E>, keyof Shared>,
					) => Atom.Atom<MicroEndpointResult<E>>;
					subscription: (
						payload: Omit<InferMicroArgs<E>, keyof Shared>,
					) => Atom.Atom<MicroEndpointResult<E>>;
				}
		: InferMicroKind<E> extends "mutation"
			? {
					mutate: Atom.AtomResultFn<
						Omit<InferMicroArgs<E>, keyof Shared>,
						InferMicroSuccess<E>,
						InferMicroError<E>
					>;
				}
			: InferMicroKind<E> extends "action"
				? {
						call: Atom.AtomResultFn<
							Omit<InferMicroArgs<E>, keyof Shared>,
							InferMicroSuccess<E>,
							InferMicroError<E>
						>;
					}
				: never;

type MicroEndpointsRecord = Record<
	string,
	MicroRpcEndpoint<string, PropertyValidators, unknown, unknown, unknown, "query" | "mutation" | "action">
>;

export type MicroRpcModuleClient<
	TEndpoints extends MicroEndpointsRecord,
	Shared extends Record<string, unknown> = {},
> = {
	readonly runtime: Atom.AtomRuntime<ConvexClient>;
} & {
	readonly [K in keyof TEndpoints]: DecorateMicroEndpoint<TEndpoints[K], Shared>;
};

const createMicroQueryAtom = (
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
			const exit = decodeMicroExit(encodedExit as MicroExit<unknown, unknown>);
			if (Exit.isSuccess(exit)) {
				return exit.value;
			}
			return yield* exit;
		}),
	);
};

const createMicroSubscriptionAtom = (
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
							const exit = decodeMicroExit(encodedExit as MicroExit<unknown, unknown>);
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

const createMicroMutationFn = (
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
			const exit = decodeMicroExit(encodedExit as MicroExit<unknown, unknown>);
			if (Exit.isSuccess(exit)) {
				return exit.value;
			}
			return yield* exit;
		}),
	);
};

const createMicroActionFn = (
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
			const exit = decodeMicroExit(encodedExit as MicroExit<unknown, unknown>);
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

const createMicroPaginatedAtom = (
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
				const encodedExit = yield* client.query(
					convexFn,
					fullPayload as Record<string, unknown>,
				);
				const exit = decodeMicroExit(encodedExit as MicroExit<unknown, unknown>);
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

export const makeMicroClient = <
	TEndpoints extends MicroEndpointsRecord,
	Shared extends Record<string, unknown> = {},
>(
	convexApi: ConvexApiModule,
	config: MicroRpcModuleClientConfig,
	getShared: () => Shared = () => ({}) as Shared,
): MicroRpcModuleClient<TEndpoints, Shared> => {
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
	const paginatedFamilies = new Map<
		string,
		(numItems: number) => Atom.Writable<Atom.PullResult<unknown, unknown>, void>
	>();

	const getQueryFamily = (tag: string) => {
		let family = queryFamilies.get(tag);
		if (!family) {
			const convexFn = convexApi[tag] as FunctionReference<"query">;
			family = Atom.family((p: unknown) => {
				const fullPayload = { ...getShared(), ...(p as object) };
				return createMicroQueryAtom(runtime, convexFn, fullPayload);
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
				return createMicroSubscriptionAtom(runtime, convexFn, fullPayload);
			});
			subscriptionFamilies.set(tag, family);
		}
		return family;
	};

	const getMutationFn = (tag: string) => {
		let fn = mutationFns.get(tag);
		if (!fn) {
			const convexFn = convexApi[tag] as FunctionReference<"mutation">;
			fn = createMicroMutationFn(runtime, convexFn, getShared);
			mutationFns.set(tag, fn);
		}
		return fn;
	};

	const getActionFn = (tag: string) => {
		let fn = actionFns.get(tag);
		if (!fn) {
			const convexFn = convexApi[tag] as FunctionReference<"action">;
			fn = createMicroActionFn(runtime, convexFn, getShared);
			actionFns.set(tag, fn);
		}
		return fn;
	};

	const getPaginatedFamily = (tag: string) => {
		let family = paginatedFamilies.get(tag);
		if (!family) {
			const convexFn = convexApi[tag] as FunctionReference<"query">;
			family = Atom.family((numItems: number) =>
				createMicroPaginatedAtom(runtime, convexFn, getShared, numItems),
			);
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
					subscription: (payload: unknown) =>
						getSubscriptionFamily(prop)(payload),
					mutate: getMutationFn(prop),
					call: getActionFn(prop),
					paginated: (numItems: number) => getPaginatedFamily(prop)(numItems),
				};
				endpointProxyCache.set(prop, endpointProxy);
			}
			return endpointProxy;
		},
	});

	return proxy as unknown as MicroRpcModuleClient<TEndpoints, Shared>;
};

export const makeMicroClientWithShared = <
	TEndpoints extends MicroEndpointsRecord,
	Shared extends Record<string, unknown>,
>(
	convexApi: ConvexApiModule,
	config: MicroRpcModuleClientConfig,
	getShared: () => Shared,
): MicroRpcModuleClient<TEndpoints, Shared> => {
	return makeMicroClient<TEndpoints, Shared>(convexApi, config, getShared);
};

type MicroModuleWithEndpoints = {
	readonly _def: { readonly endpoints: MicroEndpointsRecord };
};

type DecoratedMicroEndpoints<M, Shared extends Record<string, unknown>> = {
	readonly [K in keyof M as K extends "_def" | "handlers" ? never : K]: M[K] extends MicroRpcEndpoint<
		string,
		PropertyValidators,
		unknown,
		unknown,
		unknown,
		"query" | "mutation" | "action"
	>
		? DecorateMicroEndpoint<M[K], Shared>
		: never;
};

export type MicroRpcModuleClientFromModule<
	M extends MicroModuleWithEndpoints,
	Shared extends Record<string, unknown> = {},
> = {
	readonly runtime: Atom.AtomRuntime<ConvexClient>;
} & DecoratedMicroEndpoints<M, Shared>;

export function createMicroClient<
	M extends MicroModuleWithEndpoints,
	Shared extends Record<string, unknown> = {},
>(
	convexApi: ConvexApiModule,
	config: MicroRpcModuleClientConfig,
	getShared: () => Shared = () => ({}) as Shared,
): MicroRpcModuleClientFromModule<M, Shared> {
	return makeMicroClient<M["_def"]["endpoints"], Shared>(
		convexApi,
		config,
		getShared,
	) as unknown as MicroRpcModuleClientFromModule<M, Shared>;
}
