import { Atom, Result } from "@effect-atom/atom";
import type { FunctionReference, FunctionReturnType } from "convex/server";
import { Effect, Schema, Stream } from "effect";
import { ConvexClient } from "./convex-client";

export const convexQuery = <Query extends FunctionReference<"query">>(
	query: Query,
	args: Query["_args"],
): Effect.Effect<FunctionReturnType<Query>, never, ConvexClient> =>
	Effect.flatMap(ConvexClient, (client) => client.query(query, args));

export const convexMutation = <Mutation extends FunctionReference<"mutation">>(
	mutation: Mutation,
	args: Mutation["_args"],
): Effect.Effect<FunctionReturnType<Mutation>, never, ConvexClient> =>
	Effect.flatMap(ConvexClient, (client) => client.mutation(mutation, args));

export const convexAction = <Action extends FunctionReference<"action">>(
	action: Action,
	args: Action["_args"],
): Effect.Effect<FunctionReturnType<Action>, never, ConvexClient> =>
	Effect.flatMap(ConvexClient, (client) => client.action(action, args));

export const convexSubscribe = <Query extends FunctionReference<"query">>(
	query: Query,
	args: Query["_args"],
): Stream.Stream<FunctionReturnType<Query>, never, ConvexClient> =>
	Stream.unwrap(
		Effect.map(ConvexClient, (client) => client.subscribe(query, args)),
	);

export interface ConvexQueryAtomOptions<
	Query extends FunctionReference<"query">,
	Decoded,
> {
	readonly query: Query;
	readonly args: Query["_args"];
	readonly schema?: Schema.Schema<Decoded, FunctionReturnType<Query>>;
}

export const convexQueryAtom = <
	Query extends FunctionReference<"query">,
	Decoded = FunctionReturnType<Query>,
>(
	runtime: Atom.AtomRuntime<ConvexClient>,
	options: ConvexQueryAtomOptions<Query, Decoded>,
): Atom.Atom<Result.Result<Decoded>> => {
	const effect = Effect.gen(function* () {
		const client = yield* ConvexClient;
		const result = yield* client.query(options.query, options.args);

		if (options.schema) {
			return yield* Schema.decode(options.schema)(result).pipe(Effect.orDie);
		}
		return result as Decoded;
	});

	return runtime.atom(effect);
};

export const convexSubscriptionAtom = <
	Query extends FunctionReference<"query">,
	Decoded = FunctionReturnType<Query>,
>(
	runtime: Atom.AtomRuntime<ConvexClient>,
	options: ConvexQueryAtomOptions<Query, Decoded>,
): Atom.Atom<Result.Result<Decoded>> => {
	const stream = Stream.unwrap(
		Effect.gen(function* () {
			const client = yield* ConvexClient;
			const baseStream = client.subscribe(options.query, options.args);

			if (options.schema) {
				return Stream.mapEffect(baseStream, (result) =>
					Schema.decode(options.schema!)(result).pipe(Effect.orDie),
				);
			}
			return baseStream;
		}),
	);

	return runtime.atom(stream);
};

export const convexMutationAtom = <
	Mutation extends FunctionReference<"mutation">,
>(
	runtime: Atom.AtomRuntime<ConvexClient>,
	mutation: Mutation,
) => {
	return runtime.fn(
		Effect.fnUntraced(function* (args: Mutation["_args"]) {
			const client = yield* ConvexClient;
			return yield* client.mutation(mutation, args);
		}),
	);
};

export const convexActionAtom = <Action extends FunctionReference<"action">>(
	runtime: Atom.AtomRuntime<ConvexClient>,
	action: Action,
) => {
	return runtime.fn(
		Effect.fnUntraced(function* (args: Action["_args"]) {
			const client = yield* ConvexClient;
			return yield* client.action(action, args);
		}),
	);
};
