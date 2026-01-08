import type { FunctionReference, FunctionReturnType } from "convex/server";
import { ConvexClient as ConvexClientImpl } from "convex/browser";
import { Context, Effect, Layer, Stream } from "effect";

export interface ConvexClientService {
	query<Query extends FunctionReference<"query">>(
		query: Query,
		args: Query["_args"],
	): Effect.Effect<FunctionReturnType<Query>>;

	mutation<Mutation extends FunctionReference<"mutation">>(
		mutation: Mutation,
		args: Mutation["_args"],
	): Effect.Effect<FunctionReturnType<Mutation>>;

	action<Action extends FunctionReference<"action">>(
		action: Action,
		args: Action["_args"],
	): Effect.Effect<FunctionReturnType<Action>>;

	subscribe<Query extends FunctionReference<"query">>(
		query: Query,
		args: Query["_args"],
	): Stream.Stream<FunctionReturnType<Query>>;
}

export class ConvexClient extends Context.Tag("@confect/ConvexClient")<
	ConvexClient,
	ConvexClientService
>() {}

export const ConvexClientLayer = (
	url: string,
): Layer.Layer<ConvexClient> => {
	const client = new ConvexClientImpl(url);

	const service: ConvexClientService = {
		query: <Query extends FunctionReference<"query">>(
			query: Query,
			args: Query["_args"],
		): Effect.Effect<FunctionReturnType<Query>> =>
			Effect.promise(() => client.query(query, args)),

		mutation: <Mutation extends FunctionReference<"mutation">>(
			mutation: Mutation,
			args: Mutation["_args"],
		): Effect.Effect<FunctionReturnType<Mutation>> =>
			Effect.promise(() => client.mutation(mutation, args)),

		action: <Action extends FunctionReference<"action">>(
			action: Action,
			args: Action["_args"],
		): Effect.Effect<FunctionReturnType<Action>> =>
			Effect.promise(() => client.action(action, args)),

		subscribe: <Query extends FunctionReference<"query">>(
			query: Query,
			args: Query["_args"],
		): Stream.Stream<FunctionReturnType<Query>> =>
			Stream.async<FunctionReturnType<Query>>((emit) => {
				const unsubscribe = client.onUpdate(query, args, (result) => {
					emit.single(result);
				});
				return Effect.sync(() => {
					unsubscribe();
				});
			}),
	};

	return Layer.succeed(ConvexClient, service);
};
