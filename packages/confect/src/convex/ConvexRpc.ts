import { Rpc } from "@effect/rpc";
import type { Schema } from "effect";
import { ConvexFunctionType, type FunctionType } from "./ConvexFunctionType";

export const TypeId: unique symbol = Symbol.for("@confect/ConvexRpc");
export type TypeId = typeof TypeId;

export interface ConvexRpc<
	Tag extends string,
	FnType extends FunctionType,
	Payload extends Schema.Schema.Any = typeof Schema.Void,
	Success extends Schema.Schema.Any = typeof Schema.Void,
	Error extends Schema.Schema.All = typeof Schema.Never,
> {
	readonly [TypeId]: TypeId;
	readonly _fnType: FnType;
	readonly rpc: Rpc.Rpc<Tag, Payload, Success, Error>;
}

export type Any = ConvexRpc<string, FunctionType, Schema.Schema.Any, Schema.Schema.Any, Schema.Schema.All>;

export type FnType<R> = R extends ConvexRpc<infer _Tag, infer T, infer _P, infer _S, infer _E> ? T : never;
export type Tag<R> = R extends ConvexRpc<infer T, infer _FnType, infer _P, infer _S, infer _E> ? T : never;
export type Payload<R> = R extends ConvexRpc<infer _Tag, infer _FnType, infer P, infer _S, infer _E> ? Schema.Schema.Type<P> : never;
export type Success<R> = R extends ConvexRpc<infer _Tag, infer _FnType, infer _P, infer S, infer _E> ? Schema.Schema.Type<S> : never;
export type Error<R> = R extends ConvexRpc<infer _Tag, infer _FnType, infer _P, infer _S, infer E> ? Schema.Schema.Type<E> : never;
export type InnerRpc<R> = R extends ConvexRpc<infer _Tag, infer _FnType, infer _P, infer _S, infer _E> ? R["rpc"] : never;

const make = <FnType extends FunctionType>(fnType: FnType) =>
	<
		const Tag extends string,
		Options extends {
			readonly payload?: Schema.Struct.Fields | Schema.Schema.Any;
			readonly success?: Schema.Schema.Any;
			readonly error?: Schema.Schema.All;
		},
	>(
		tag: Tag,
		options?: Options,
	): ConvexRpc<
		Tag,
		FnType,
		Options extends { payload: infer P }
			? P extends Schema.Schema.Any
				? P
				: P extends Schema.Struct.Fields
					? Schema.Struct<P>
					: typeof Schema.Void
			: typeof Schema.Void,
		Options extends { success: infer S }
			? S extends Schema.Schema.Any
				? S
				: typeof Schema.Void
			: typeof Schema.Void,
		Options extends { error: infer E }
			? E extends Schema.Schema.All
				? E
				: typeof Schema.Never
			: typeof Schema.Never
	> => {
		const rpc = Rpc.make(tag, options as never).annotate(ConvexFunctionType, fnType);
		return {
			[TypeId]: TypeId,
			_fnType: fnType,
			rpc: rpc as never,
		} as never;
	};

export const query = make("query");
export const mutation = make("mutation");
export const action = make("action");
