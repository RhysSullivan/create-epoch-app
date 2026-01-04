import {
	ConvexClient as ConvexBrowserClient,
	ConvexHttpClient,
} from "convex/browser";
import type { FunctionReference, FunctionReturnType } from "convex/server";
import { Cause, Context, Effect, Layer, Stream } from "effect";

export interface ConvexClientService {
	readonly query: <Query extends FunctionReference<"query">>(
		query: Query,
		args: Query["_args"],
	) => Effect.Effect<FunctionReturnType<Query>>;

	readonly mutation: <Mutation extends FunctionReference<"mutation">>(
		mutation: Mutation,
		args: Mutation["_args"],
	) => Effect.Effect<FunctionReturnType<Mutation>>;

	readonly action: <Action extends FunctionReference<"action">>(
		action: Action,
		args: Action["_args"],
	) => Effect.Effect<FunctionReturnType<Action>>;

	readonly subscribe: <Query extends FunctionReference<"query">>(
		query: Query,
		args: Query["_args"],
	) => Stream.Stream<FunctionReturnType<Query>>;
}

export class ConvexClient extends Context.Tag("ConvexClient")<
	ConvexClient,
	ConvexClientService
>() {}

export const makeConvexClient = (url: string): ConvexClientService => {
	const client = new ConvexBrowserClient(url);

	return {
		query: (query, args) =>
			Effect.promise(() => client.query(query, args)),

		mutation: (mutation, args) =>
			Effect.promise(() => client.mutation(mutation, args)),

		action: (action, args) =>
			Effect.promise(() => client.action(action, args)),

		subscribe: (query, args) =>
			Stream.async<FunctionReturnType<typeof query>>((emit) => {
				const unsubscribe = client.onUpdate(query, args, (result) => {
					emit.single(result);
				});

				return Effect.sync(() => {
					unsubscribe();
				});
			}),
	};
};

export const makeConvexHttpClient = (url: string): ConvexClientService => {
	const client = new ConvexHttpClient(url);

	return {
		query: (query, args) =>
			Effect.promise(() => client.query(query, args)),

		mutation: (mutation, args) =>
			Effect.promise(() => client.mutation(mutation, args)),

		action: (action, args) =>
			Effect.promise(() => client.action(action, args)),

		subscribe: () =>
			Stream.failCause(
				Cause.die(new Error("HTTP client does not support subscriptions")),
			),
	};
};

export const ConvexClientLayer = (url: string) =>
	Layer.succeed(ConvexClient, makeConvexClient(url));

export const ConvexHttpClientLayer = (url: string) =>
	Layer.succeed(ConvexClient, makeConvexHttpClient(url));
