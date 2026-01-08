import type { FunctionReference } from "convex/server";
import { Atom, Result } from "@effect-atom/atom";
import { Effect, Exit, Schema, Stream, pipe } from "effect";

import { ConvexClient, ConvexClientLayer } from "../client";
import type {
	RpcModule,
	RpcDefinitions,
	RpcQueryDefinition,
	RpcMutationDefinition,
	RpcResultEncoded,
} from "./server";

export class RpcDefectError {
	readonly _tag = "RpcDefectError";
	constructor(readonly defect: unknown) {}
}

type InferPayload<D> = D extends RpcQueryDefinition<infer P, infer _S, infer _E>
	? P extends Schema.Schema.AnyNoContext
		? P["Type"]
		: void
	: D extends RpcMutationDefinition<infer P, infer _S, infer _E>
		? P extends Schema.Schema.AnyNoContext
			? P["Type"]
			: void
		: never;

type InferSuccess<D> = D extends RpcQueryDefinition<infer _P, infer S, infer _E>
	? S["Type"]
	: D extends RpcMutationDefinition<infer _P, infer S, infer _E>
		? S["Type"]
		: never;

type InferError<D> = D extends RpcQueryDefinition<infer _P, infer _S, infer E>
	? E extends Schema.Schema.AnyNoContext
		? E["Type"]
		: never
	: D extends RpcMutationDefinition<infer _P, infer _S, infer E>
		? E extends Schema.Schema.AnyNoContext
			? E["Type"]
			: never
		: never;

type RpcQueryClient<Payload, Success, Error> = {
	query: (payload: Payload) => Atom.Atom<Result.Result<Success, Error | RpcDefectError>>;
	subscription: (payload: Payload) => Atom.Atom<Result.Result<Success, Error | RpcDefectError>>;
};

type RpcMutationClient<Payload, Success, Error> = {
	mutate: Atom.AtomResultFn<Payload, Success, Error | RpcDefectError>;
};

type RpcModuleClientMethods<Defs extends RpcDefinitions> = {
	[K in keyof Defs]: Defs[K] extends RpcQueryDefinition<infer _P, infer _S, infer _E>
		? RpcQueryClient<InferPayload<Defs[K]>, InferSuccess<Defs[K]>, InferError<Defs[K]>>
		: Defs[K] extends RpcMutationDefinition<infer _P, infer _S, infer _E>
			? RpcMutationClient<InferPayload<Defs[K]>, InferSuccess<Defs[K]>, InferError<Defs[K]>>
			: never;
};

export interface RpcModuleClientConfig {
	readonly url: string;
}

type ConvexApiModule = Record<
	string,
	FunctionReference<"query" | "mutation" | "action">
>;

export type RpcModuleClient<
	TModule extends RpcModule<RpcDefinitions>,
> = {
	readonly runtime: Atom.AtomRuntime<ConvexClient>;
} & RpcModuleClientMethods<TModule["definitions"]>;

const decodeRpcResult = (
	result: RpcResultEncoded<unknown, unknown>,
): Exit.Exit<unknown, unknown> => {
	if (result._tag === "success") {
		return Exit.succeed(result.value);
	}
	if (result._tag === "failure") {
		return Exit.fail(result.error);
	}
	return Exit.fail(new RpcDefectError(result.defect));
};

const createQueryAtom = (
	runtime: Atom.AtomRuntime<ConvexClient>,
	convexFn: FunctionReference<"query">,
	payload: unknown,
): Atom.Atom<Result.Result<unknown, unknown>> => {
	return runtime.atom(
		Effect.gen(function* () {
			const client = yield* ConvexClient;
			const result = yield* client.query(
				convexFn,
				{ payload } as Record<string, unknown>,
			);
			const exit = decodeRpcResult(result as RpcResultEncoded<unknown, unknown>);
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
					.subscribe(convexFn, { payload } as Record<string, unknown>)
					.pipe(
						Stream.mapEffect((encodedResult) => {
							const exit = decodeRpcResult(encodedResult as RpcResultEncoded<unknown, unknown>);
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
): Atom.AtomResultFn<unknown, unknown, unknown> => {
	return runtime.fn<unknown>()(
		Effect.fnUntraced(function* (payload) {
			const client = yield* ConvexClient;
			const result = yield* client.mutation(
				convexFn,
				{ payload } as Record<string, unknown>,
			);
			const exit = decodeRpcResult(result as RpcResultEncoded<unknown, unknown>);
			if (Exit.isSuccess(exit)) {
				return exit.value;
			}
			return yield* exit;
		}),
	);
};

const noop = () => {};

export function createRpcClient<TModule extends RpcModule<RpcDefinitions>>(
	convexApi: ConvexApiModule,
	config: RpcModuleClientConfig,
): RpcModuleClient<TModule> {
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

	const getQueryFamily = (tag: string) => {
		let family = queryFamilies.get(tag);
		if (!family) {
			const convexFn = convexApi[tag] as FunctionReference<"query">;
			family = Atom.family((p: unknown) => createQueryAtom(runtime, convexFn, p));
			queryFamilies.set(tag, family);
		}
		return family;
	};

	const getSubscriptionFamily = (tag: string) => {
		let family = subscriptionFamilies.get(tag);
		if (!family) {
			const convexFn = convexApi[tag] as FunctionReference<"query">;
			family = Atom.family((p: unknown) => createSubscriptionAtom(runtime, convexFn, p));
			subscriptionFamilies.set(tag, family);
		}
		return family;
	};

	const getMutationFn = (tag: string) => {
		let fn = mutationFns.get(tag);
		if (!fn) {
			const convexFn = convexApi[tag] as FunctionReference<"mutation">;
			fn = createMutationFn(runtime, convexFn);
			mutationFns.set(tag, fn);
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
					subscription: (payload: unknown) => getSubscriptionFamily(prop)(payload),
					mutate: getMutationFn(prop),
				};
				endpointProxyCache.set(prop, endpointProxy);
			}
			return endpointProxy;
		},
	});

	return proxy as unknown as RpcModuleClient<TModule>;
}

export type {
	RpcQueryClient,
	RpcMutationClient,
	RpcModuleClientMethods,
};
