import { RpcGroup } from "@effect/rpc";
import type * as ConvexRpc from "./ConvexRpc";

export const TypeId: unique symbol = Symbol.for("@confect/ConvexRpcGroup");
export type TypeId = typeof TypeId;

export interface ConvexRpcGroup<out R extends ConvexRpc.Any> {
	readonly [TypeId]: TypeId;
	readonly rpcs: ReadonlyMap<string, R>;
	readonly rpcGroup: RpcGroup.RpcGroup<ConvexRpc.InnerRpc<R>>;
}

export type Any = ConvexRpcGroup<ConvexRpc.Any>;

export type Rpcs<Group> = Group extends ConvexRpcGroup<infer R> ? R : never;

export const make = <const Rpcs extends ReadonlyArray<ConvexRpc.Any>>(
	...rpcs: Rpcs
): ConvexRpcGroup<Rpcs[number]> => {
	const rpcMap = new Map<string, Rpcs[number]>();
	const innerRpcs: Array<unknown> = [];
	
	for (const rpc of rpcs) {
		rpcMap.set((rpc.rpc as { _tag: string })._tag, rpc);
		innerRpcs.push(rpc.rpc);
	}
	
	return {
		[TypeId]: TypeId,
		rpcs: rpcMap,
		rpcGroup: RpcGroup.make(...(innerRpcs as never)) as never,
	};
};
