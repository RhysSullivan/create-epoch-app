import * as Context from "effect/Context";
import { pipeArguments } from "effect/Pipeable";
import type * as Schema from "effect/Schema";

export const TypeId: unique symbol = Symbol.for("@confect/Rpc");
export type TypeId = typeof TypeId;

export type FunctionType = "query" | "mutation" | "action";

export interface Rpc<
	Tag extends string,
	Type extends FunctionType,
	Payload extends Schema.Schema.Any = typeof Schema.Void,
	Success extends Schema.Schema.Any = typeof Schema.Void,
	Error extends Schema.Schema.All = typeof Schema.Never,
> {
	readonly [TypeId]: TypeId;
	readonly _tag: Tag;
	readonly _type: Type;
	readonly payloadSchema: Payload;
	readonly successSchema: Success;
	readonly errorSchema: Error;
	readonly annotations: Context.Context<never>;

	setPayload<P extends Schema.Schema.Any>(
		schema: P,
	): Rpc<Tag, Type, P, Success, Error>;

	setPayload<
		Fields extends {
			readonly [key: string]: Schema.Schema.Any | Schema.PropertySignature.Any;
		},
	>(
		fields: Fields,
	): Rpc<
		Tag,
		Type,
		Schema.Struct<Fields> extends Schema.Schema.Any
			? Schema.Struct<Fields>
			: Payload,
		Success,
		Error
	>;

	setSuccess<S extends Schema.Schema.Any>(
		schema: S,
	): Rpc<Tag, Type, Payload, S, Error>;

	setError<E extends Schema.Schema.All>(
		schema: E,
	): Rpc<Tag, Type, Payload, Success, E>;

	annotate<I, S>(
		tag: Context.Tag<I, S>,
		value: S,
	): Rpc<Tag, Type, Payload, Success, Error>;

	pipe<A>(this: A, ...args: ReadonlyArray<unknown>): unknown;
}

export type Any = Rpc<string, FunctionType, Schema.Schema.Any, Schema.Schema.Any, Schema.Schema.All>;

export type Payload<R> = R extends Rpc<
	infer _Tag,
	infer _Type,
	infer P,
	infer _Success,
	infer _Error
>
	? Schema.Schema.Type<P>
	: never;

export type PayloadEncoded<R> = R extends Rpc<
	infer _Tag,
	infer _Type,
	infer P,
	infer _Success,
	infer _Error
>
	? Schema.Schema.Encoded<P>
	: never;

export type Success<R> = R extends Rpc<
	infer _Tag,
	infer _Type,
	infer _Payload,
	infer S,
	infer _Error
>
	? Schema.Schema.Type<S>
	: never;

export type SuccessEncoded<R> = R extends Rpc<
	infer _Tag,
	infer _Type,
	infer _Payload,
	infer S,
	infer _Error
>
	? Schema.Schema.Encoded<S>
	: never;

export type Error<R> = R extends Rpc<
	infer _Tag,
	infer _Type,
	infer _Payload,
	infer _Success,
	infer E
>
	? Schema.Schema.Type<E>
	: never;

export type Tag<R> = R extends Rpc<
	infer T,
	infer _Type,
	infer _Payload,
	infer _Success,
	infer _Error
>
	? T
	: never;

export type Type<R> = R extends Rpc<
	infer _Tag,
	infer T,
	infer _Payload,
	infer _Success,
	infer _Error
>
	? T
	: never;

import * as S from "effect/Schema";

const Proto = {
	[TypeId]: TypeId as TypeId,
	pipe(this: unknown) {
		return pipeArguments(this, arguments);
	},
	setPayload(
		this: RpcImpl<string, FunctionType, Schema.Schema.Any, Schema.Schema.Any, Schema.Schema.All>,
		schema: Schema.Schema.Any | Record<string, Schema.Schema.Any>,
	) {
		const payloadSchema = S.isSchema(schema) ? schema : S.Struct(schema);
		return makeRpc({
			_tag: this._tag,
			_type: this._type,
			payloadSchema,
			successSchema: this.successSchema,
			errorSchema: this.errorSchema,
			annotations: this.annotations,
		});
	},
	setSuccess(
		this: RpcImpl<string, FunctionType, Schema.Schema.Any, Schema.Schema.Any, Schema.Schema.All>,
		schema: Schema.Schema.Any,
	) {
		return makeRpc({
			_tag: this._tag,
			_type: this._type,
			payloadSchema: this.payloadSchema,
			successSchema: schema,
			errorSchema: this.errorSchema,
			annotations: this.annotations,
		});
	},
	setError(
		this: RpcImpl<string, FunctionType, Schema.Schema.Any, Schema.Schema.Any, Schema.Schema.All>,
		schema: Schema.Schema.All,
	) {
		return makeRpc({
			_tag: this._tag,
			_type: this._type,
			payloadSchema: this.payloadSchema,
			successSchema: this.successSchema,
			errorSchema: schema,
			annotations: this.annotations,
		});
	},
	annotate(
		this: RpcImpl<string, FunctionType, Schema.Schema.Any, Schema.Schema.Any, Schema.Schema.All>,
		tag: Context.Tag<unknown, unknown>,
		value: unknown,
	) {
		return makeRpc({
			_tag: this._tag,
			_type: this._type,
			payloadSchema: this.payloadSchema,
			successSchema: this.successSchema,
			errorSchema: this.errorSchema,
			annotations: Context.add(this.annotations, tag, value),
		});
	},
};

interface RpcImpl<
	Tag extends string,
	Type extends FunctionType,
	Payload extends Schema.Schema.Any,
	Success extends Schema.Schema.Any,
	Error extends Schema.Schema.All,
> {
	readonly [TypeId]: TypeId;
	readonly _tag: Tag;
	readonly _type: Type;
	readonly payloadSchema: Payload;
	readonly successSchema: Success;
	readonly errorSchema: Error;
	readonly annotations: Context.Context<never>;
}

const makeRpc = <
	Tag extends string,
	Type extends FunctionType,
	Payload extends Schema.Schema.Any,
	Success extends Schema.Schema.Any,
	Error extends Schema.Schema.All,
>(options: {
	_tag: Tag;
	_type: Type;
	payloadSchema: Payload;
	successSchema: Success;
	errorSchema: Error;
	annotations: Context.Context<never>;
}): Rpc<Tag, Type, Payload, Success, Error> => {
	const rpc = Object.create(Proto);
	return Object.assign(rpc, options);
};

export const Query = <const Tag extends string>(
	tag: Tag,
): Rpc<Tag, "query", typeof S.Void, typeof S.Void, typeof S.Never> =>
	makeRpc({
		_tag: tag,
		_type: "query" as const,
		payloadSchema: S.Void,
		successSchema: S.Void,
		errorSchema: S.Never,
		annotations: Context.empty(),
	});

export const Mutation = <const Tag extends string>(
	tag: Tag,
): Rpc<Tag, "mutation", typeof S.Void, typeof S.Void, typeof S.Never> =>
	makeRpc({
		_tag: tag,
		_type: "mutation" as const,
		payloadSchema: S.Void,
		successSchema: S.Void,
		errorSchema: S.Never,
		annotations: Context.empty(),
	});

export const Action = <const Tag extends string>(
	tag: Tag,
): Rpc<Tag, "action", typeof S.Void, typeof S.Void, typeof S.Never> =>
	makeRpc({
		_tag: tag,
		_type: "action" as const,
		payloadSchema: S.Void,
		successSchema: S.Void,
		errorSchema: S.Never,
		annotations: Context.empty(),
	});
