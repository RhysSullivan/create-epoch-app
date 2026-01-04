import { Atom, Result } from "@effect-atom/atom";
import type { FunctionReference, FunctionReturnType } from "convex/server";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import { pipe } from "effect/Function";
import * as Hash from "effect/Hash";
import * as Layer from "effect/Layer";
import type { Schema } from "effect/Schema";
import * as Stream from "effect/Stream";
import {
	ConvexClient,
	ConvexClientLayer,
	type ConvexClientService,
} from "./convex-client";

export interface AtomConvexClient<Self, Id extends string, E>
	extends Context.Tag<Self, ConvexClientService> {
	new (_: never): Context.TagClassShape<Id, ConvexClientService>;

	readonly layer: Layer.Layer<Self, E>;
	readonly runtime: Atom.AtomRuntime<Self, E>;

	readonly mutation: <Mutation extends FunctionReference<"mutation">>(
		mutation: Mutation,
	) => Atom.AtomResultFn<Mutation["_args"], FunctionReturnType<Mutation>, E>;

	readonly action: <Action extends FunctionReference<"action">>(
		action: Action,
	) => Atom.AtomResultFn<Action["_args"], FunctionReturnType<Action>, E>;

	readonly query: <
		Query extends FunctionReference<"query">,
		Decoded = FunctionReturnType<Query>,
	>(
		query: Query,
		args: Query["_args"],
		options?: {
			readonly schema?: Schema<Decoded, FunctionReturnType<Query>>;
		},
	) => Atom.Atom<Result.Result<Decoded, E>>;

	readonly subscription: <
		Query extends FunctionReference<"query">,
		Decoded = FunctionReturnType<Query>,
	>(
		query: Query,
		args: Query["_args"],
		options?: {
			readonly schema?: Schema<Decoded, FunctionReturnType<Query>>;
		},
	) => Atom.Atom<Result.Result<Decoded, E>>;
}

export const Tag = <Self>() =>
<const Id extends string, ER = never>(
	id: Id,
	options: {
		readonly url: string;
		readonly makeLayer?: (url: string) => Layer.Layer<ConvexClient, ER>;
	},
): AtomConvexClient<Self, Id, ER> => {
	const makeLayer = options.makeLayer ?? (ConvexClientLayer as (url: string) => Layer.Layer<ConvexClient, ER>);

	const tag = Context.Tag(id)<Self, ConvexClientService>();
	
	const layer = Layer.effect(
		tag,
		Effect.map(ConvexClient, (client) => client),
	).pipe(Layer.provide(makeLayer(options.url)));

	const runtime = Atom.runtime(layer);

	const mutation = Atom.family(
		<Mutation extends FunctionReference<"mutation">>(mutation: Mutation) =>
			runtime.fn(
				Effect.fnUntraced(function* (args: Mutation["_args"]) {
					const client = yield* tag;
					return yield* client.mutation(mutation, args);
				}),
			),
	);

	const action = Atom.family(
		<Action extends FunctionReference<"action">>(action: Action) =>
			runtime.fn(
				Effect.fnUntraced(function* (args: Action["_args"]) {
					const client = yield* tag;
					return yield* client.action(action, args);
				}),
			),
	);

	const queryFamily = Atom.family(
		<Query extends FunctionReference<"query">, Decoded>(
			key: QueryKey<Query, Decoded>,
		) => {
			const effect = Effect.gen(function* () {
				const client = yield* tag;
				const result = yield* client.query(key.query, key.args);

				if (key.schema) {
					const { Schema } = yield* Effect.promise(() => import("effect"));
					return yield* Schema.decode(key.schema)(result).pipe(Effect.orDie);
				}
				return result as Decoded;
			});

			return runtime.atom(effect);
		},
	);

	const query = <
		Query extends FunctionReference<"query">,
		Decoded = FunctionReturnType<Query>,
	>(
		queryRef: Query,
		args: Query["_args"],
		opts?: {
			readonly schema?: Schema<Decoded, FunctionReturnType<Query>>;
		},
	) =>
		queryFamily(
			new QueryKey({
				query: queryRef,
				args: Data.struct(args),
				schema: opts?.schema,
			}),
		) as Atom.Atom<Result.Result<Decoded, ER>>;

	const subscriptionFamily = Atom.family(
		<Query extends FunctionReference<"query">, Decoded>(
			key: QueryKey<Query, Decoded>,
		) => {
			const stream = Stream.unwrap(
				Effect.gen(function* () {
					const client = yield* tag;
					const baseStream = client.subscribe(key.query, key.args);

					if (key.schema) {
						const { Schema } = yield* Effect.promise(() => import("effect"));
						return Stream.mapEffect(baseStream, (result) =>
							Schema.decode(key.schema!)(result).pipe(Effect.orDie),
						);
					}
					return baseStream as Stream.Stream<Decoded>;
				}),
			);

			return runtime.atom(stream);
		},
	);

	const subscription = <
		Query extends FunctionReference<"query">,
		Decoded = FunctionReturnType<Query>,
	>(
		queryRef: Query,
		args: Query["_args"],
		opts?: {
			readonly schema?: Schema<Decoded, FunctionReturnType<Query>>;
		},
	) =>
		subscriptionFamily(
			new QueryKey({
				query: queryRef,
				args: Data.struct(args),
				schema: opts?.schema,
			}),
		) as Atom.Atom<Result.Result<Decoded, ER>>;

	return Object.assign(tag, {
		layer,
		runtime,
		mutation,
		action,
		query,
		subscription,
	}) as unknown as AtomConvexClient<Self, Id, ER>;
};

class QueryKey<Query extends FunctionReference<"query">, Decoded> extends Data.Class<{
	query: Query;
	args: Query["_args"];
	schema?: Schema<Decoded, FunctionReturnType<Query>>;
}> {
	[Equal.symbol](that: QueryKey<Query, Decoded>) {
		return (
			this.query === that.query &&
			Equal.equals(this.args, that.args) &&
			this.schema === that.schema
		);
	}
	[Hash.symbol]() {
		return pipe(
			Hash.hash(this.query),
			Hash.combine(Hash.hash(this.args)),
			Hash.combine(Hash.hash(this.schema)),
			Hash.cached(this),
		);
	}
}
