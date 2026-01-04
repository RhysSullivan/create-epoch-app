import { identity } from "effect/Function";
import type * as Effect from "effect/Effect";
import type * as Rpc from "./Rpc";

export const TypeId: unique symbol = Symbol.for("@confect/RpcGroup");
export type TypeId = typeof TypeId;

export interface RpcGroup<out R extends Rpc.Any> {
	readonly [TypeId]: TypeId;
	readonly rpcs: ReadonlyMap<string, R>;

	add<const Rpcs extends ReadonlyArray<Rpc.Any>>(
		...rpcs: Rpcs
	): RpcGroup<R | Rpcs[number]>;

	merge<R2 extends Rpc.Any>(other: RpcGroup<R2>): RpcGroup<R | R2>;

	get<Tag extends Rpc.Tag<R>>(tag: Tag): Extract<R, { _tag: Tag }> | undefined;

	handlers<Ctx, const Handlers extends HandlersFrom<R, Ctx>>(handlers: Handlers): Handlers;
}

export type RpcsOf<Group> = Group extends RpcGroup<infer R> ? R : never;

export type TagsOf<Group> = Group extends RpcGroup<infer R> ? R["_tag"] : never;

export type QueryTagsOf<Group> = Group extends RpcGroup<infer R>
	? Extract<R, { _type: "query" }>["_tag"]
	: never;

export type MutationTagsOf<Group> = Group extends RpcGroup<infer R>
	? Extract<R, { _type: "mutation" }>["_tag"]
	: never;

export type ActionTagsOf<Group> = Group extends RpcGroup<infer R>
	? Extract<R, { _type: "action" }>["_tag"]
	: never;

export type RpcByTag<Group, Tag extends string> = Group extends RpcGroup<
	infer R
>
	? Extract<R, { _tag: Tag }>
	: never;

export type HandlersFrom<R extends Rpc.Any, Ctx> = {
	readonly [Current in R as Current["_tag"]]: (
		payload: Rpc.Payload<Current>,
	) => Effect.Effect<Rpc.Success<Current>, Rpc.Error<Current>, Ctx>;
};

class RpcGroupImpl<R extends Rpc.Any> implements RpcGroup<R> {
	readonly [TypeId]: TypeId = TypeId;

	constructor(readonly rpcs: ReadonlyMap<string, R>) {}

	add<const Rpcs extends ReadonlyArray<Rpc.Any>>(
		...newRpcs: Rpcs
	): RpcGroup<R | Rpcs[number]> {
		const newMap = new Map<string, R | Rpcs[number]>(this.rpcs);
		for (const rpc of newRpcs) {
			newMap.set(rpc._tag, rpc);
		}
		return new RpcGroupImpl(newMap);
	}

	merge<R2 extends Rpc.Any>(other: RpcGroup<R2>): RpcGroup<R | R2> {
		const newMap = new Map<string, R | R2>(this.rpcs);
		for (const [tag, rpc] of other.rpcs) {
			newMap.set(tag, rpc);
		}
		return new RpcGroupImpl(newMap);
	}

	get<Tag extends Rpc.Tag<R>>(tag: Tag): Extract<R, { _tag: Tag }> | undefined {
		return this.rpcs.get(tag) as Extract<R, { _tag: Tag }> | undefined;
	}

	handlers<Ctx, const Handlers extends HandlersFrom<R, Ctx>>(handlers: Handlers): Handlers {
		return identity(handlers);
	}
}

export const make = <const Rpcs extends ReadonlyArray<Rpc.Any>>(
	...rpcs: Rpcs
): RpcGroup<Rpcs[number]> => {
	const rpcMap = new Map<string, Rpcs[number]>();
	for (const rpc of rpcs) {
		rpcMap.set(rpc._tag, rpc);
	}
	return new RpcGroupImpl(rpcMap);
};

export const empty = make();
