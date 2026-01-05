import { Rpc, RpcGroup } from "@effect/rpc";
import { Atom, Result } from "@effect-atom/atom";
import type { FunctionReference } from "convex/server";
import { Context, Effect, Exit, Option, Schema } from "effect";
import { ConvexClient, ConvexClientLayer } from "../client/convex-client";
import { ConvexFunctionType, type FunctionType } from "../convex/ConvexFunctionType";

export interface RpcClientConfig {
	readonly url: string;
}

type ConvexApiModule = Record<string, FunctionReference<"query" | "mutation" | "action">>;

type AnyRpcWithProps = Rpc.AnyWithProps;

type ExtractRpcByTag<Rpcs extends Rpc.Any, Tag extends string> = Extract<Rpcs, { readonly _tag: Tag }>;

export interface RpcConvexClient<Rpcs extends Rpc.Any, Api extends ConvexApiModule> {
	readonly runtime: Atom.AtomRuntime<ConvexClient>;
	
	readonly query: <Tag extends Rpcs["_tag"] & keyof Api>(
		tag: Tag,
		payload: Rpc.Payload<ExtractRpcByTag<Rpcs, Tag & string>>,
	) => Atom.Atom<Result.Result<Rpc.Success<ExtractRpcByTag<Rpcs, Tag & string>>, Rpc.Error<ExtractRpcByTag<Rpcs, Tag & string>>>>;
	
	readonly mutation: <Tag extends Rpcs["_tag"] & keyof Api>(
		tag: Tag,
	) => Atom.AtomResultFn<
		Rpc.Payload<ExtractRpcByTag<Rpcs, Tag & string>>,
		Rpc.Success<ExtractRpcByTag<Rpcs, Tag & string>>,
		Rpc.Error<ExtractRpcByTag<Rpcs, Tag & string>>
	>;
}

export interface RpcConvexClientWithShared<
	Rpcs extends Rpc.Any, 
	Api extends ConvexApiModule,
	Shared extends Record<string, unknown>,
> {
	readonly runtime: Atom.AtomRuntime<ConvexClient>;
	
	readonly query: <Tag extends Rpcs["_tag"] & keyof Api>(
		tag: Tag,
		payload: Omit<Rpc.Payload<ExtractRpcByTag<Rpcs, Tag & string>>, keyof Shared>,
	) => Atom.Atom<Result.Result<Rpc.Success<ExtractRpcByTag<Rpcs, Tag & string>>, Rpc.Error<ExtractRpcByTag<Rpcs, Tag & string>>>>;
	
	readonly mutation: <Tag extends Rpcs["_tag"] & keyof Api>(
		tag: Tag,
	) => Atom.AtomResultFn<
		Omit<Rpc.Payload<ExtractRpcByTag<Rpcs, Tag & string>>, keyof Shared>,
		Rpc.Success<ExtractRpcByTag<Rpcs, Tag & string>>,
		Rpc.Error<ExtractRpcByTag<Rpcs, Tag & string>>
	>;
}

const getFunctionType = (rpc: AnyRpcWithProps): FunctionType =>
	Option.getOrElse(
		Context.getOption(rpc.annotations, ConvexFunctionType),
		() => "query" as FunctionType,
	);

const createQueryAtom = (
	runtime: Atom.AtomRuntime<ConvexClient>,
	rpc: AnyRpcWithProps,
	convexFn: FunctionReference<"query">,
	payload: unknown,
): Atom.Atom<Result.Result<unknown, unknown>> => {
	const exitSchema = Schema.Exit({
		success: rpc.successSchema,
		failure: rpc.errorSchema,
		defect: Schema.Defect,
	});

	return runtime.atom(
		Effect.gen(function* () {
			const client = yield* ConvexClient;
			const encoded = yield* Schema.encode(rpc.payloadSchema)(payload);
			const result = yield* client.query(convexFn, encoded as Record<string, unknown>);
			const exit = yield* Schema.decode(exitSchema)(result as Schema.Schema.Encoded<typeof exitSchema>);
			if (Exit.isFailure(exit)) {
				return yield* exit;
			}
			return exit.value;
		}),
	);
};

const createMutationFn = (
	runtime: Atom.AtomRuntime<ConvexClient>,
	rpc: AnyRpcWithProps,
	convexFn: FunctionReference<"mutation">,
	getFullPayload: (payload: unknown) => unknown,
): Atom.AtomResultFn<unknown, unknown, unknown> => {
	const exitSchema = Schema.Exit({
		success: rpc.successSchema,
		failure: rpc.errorSchema,
		defect: Schema.Defect,
	});

	return runtime.fn<unknown>()(
		Effect.fnUntraced(function* (payload) {
			const client = yield* ConvexClient;
			const fullPayload = getFullPayload(payload);
			const encoded = yield* Schema.encode(rpc.payloadSchema)(fullPayload);
			const result = yield* client.mutation(convexFn, encoded as Record<string, unknown>);
			const exit = yield* Schema.decode(exitSchema)(result as Schema.Schema.Encoded<typeof exitSchema>);
			if (Exit.isFailure(exit)) {
				return yield* exit;
			}
			return exit.value;
		}),
	);
};

export const make = <Rpcs extends Rpc.Any, Api extends ConvexApiModule>(
	group: RpcGroup.RpcGroup<Rpcs>,
	convexApi: Api,
	config: RpcClientConfig,
): RpcConvexClient<Rpcs, Api> => {
	const runtime = Atom.runtime(ConvexClientLayer(config.url));

	const queryFamilies = new Map<string, (payload: unknown) => Atom.Atom<Result.Result<unknown, unknown>>>();
	const mutationFns = new Map<string, Atom.AtomResultFn<unknown, unknown, unknown>>();

	return {
		runtime,
		query: (tag, payload) => {
			const tagStr = tag as string;
			let family = queryFamilies.get(tagStr);
			if (!family) {
				const rpc = group.requests.get(tagStr) as unknown as AnyRpcWithProps;
				const convexFn = convexApi[tagStr] as FunctionReference<"query">;
				family = Atom.family((p: unknown) => createQueryAtom(runtime, rpc, convexFn, p));
				queryFamilies.set(tagStr, family);
			}
			return family(payload) as Atom.Atom<Result.Result<Rpc.Success<ExtractRpcByTag<Rpcs, typeof tag & string>>, Rpc.Error<ExtractRpcByTag<Rpcs, typeof tag & string>>>>;
		},
		mutation: (tag) => {
			const tagStr = tag as string;
			let fn = mutationFns.get(tagStr);
			if (!fn) {
				const rpc = group.requests.get(tagStr) as unknown as AnyRpcWithProps;
				const convexFn = convexApi[tagStr] as FunctionReference<"mutation">;
				fn = createMutationFn(runtime, rpc, convexFn, (p) => p);
				mutationFns.set(tagStr, fn);
			}
			return fn as Atom.AtomResultFn<
				Rpc.Payload<ExtractRpcByTag<Rpcs, typeof tag & string>>,
				Rpc.Success<ExtractRpcByTag<Rpcs, typeof tag & string>>,
				Rpc.Error<ExtractRpcByTag<Rpcs, typeof tag & string>>
			>;
		},
	};
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
): RpcConvexClientWithShared<Rpcs, Api, Shared> => {
	const runtime = Atom.runtime(ConvexClientLayer(config.url));

	const queryFamilies = new Map<string, (payload: unknown) => Atom.Atom<Result.Result<unknown, unknown>>>();
	const mutationFns = new Map<string, Atom.AtomResultFn<unknown, unknown, unknown>>();

	return {
		runtime,
		query: (tag, payload) => {
			const tagStr = tag as string;
			let family = queryFamilies.get(tagStr);
			if (!family) {
				const rpc = group.requests.get(tagStr) as unknown as AnyRpcWithProps;
				const convexFn = convexApi[tagStr] as FunctionReference<"query">;
				family = Atom.family((p: unknown) => {
					const fullPayload = { ...getShared(), ...(p as object) };
					return createQueryAtom(runtime, rpc, convexFn, fullPayload);
				});
				queryFamilies.set(tagStr, family);
			}
			return family(payload) as Atom.Atom<Result.Result<Rpc.Success<ExtractRpcByTag<Rpcs, typeof tag & string>>, Rpc.Error<ExtractRpcByTag<Rpcs, typeof tag & string>>>>;
		},
		mutation: (tag) => {
			const tagStr = tag as string;
			let fn = mutationFns.get(tagStr);
			if (!fn) {
				const rpc = group.requests.get(tagStr) as unknown as AnyRpcWithProps;
				const convexFn = convexApi[tagStr] as FunctionReference<"mutation">;
				fn = createMutationFn(runtime, rpc, convexFn, (p) => ({
					...getShared(),
					...(p as object),
				}));
				mutationFns.set(tagStr, fn);
			}
			return fn as Atom.AtomResultFn<
				Omit<Rpc.Payload<ExtractRpcByTag<Rpcs, typeof tag & string>>, keyof Shared>,
				Rpc.Success<ExtractRpcByTag<Rpcs, typeof tag & string>>,
				Rpc.Error<ExtractRpcByTag<Rpcs, typeof tag & string>>
			>;
		},
	};
};
