import {
	queryGeneric,
	mutationGeneric,
	type GenericQueryCtx,
	type GenericMutationCtx,
	type GenericDataModel,
	type DefaultFunctionArgs,
	type RegisteredQuery,
	type RegisteredMutation,
} from "convex/server";
import { v, type Validator } from "convex/values";
import { Effect, Schema, Exit, Cause, pipe } from "effect";

import {
	ConfectQueryCtx,
	ConfectMutationCtx,
	makeQueryCtx,
	makeMutationCtx,
	type GenericConfectSchema,
	type TableNamesInSchema,
	type DocumentFromTable,
	type EncodedDocumentFromTable,
} from "../ctx";
import { schemaToArgsValidator, schemaToValidator } from "../validators";
import type { ConfectSchemaDefinition } from "../schema";

type TableSchemas<Tables extends GenericConfectSchema> = {
	[TableName in TableNamesInSchema<Tables>]: Schema.Schema<
		DocumentFromTable<Tables, TableName>,
		EncodedDocumentFromTable<Tables, TableName>
	>;
};

const buildTableSchemas = <Tables extends GenericConfectSchema>(
	tables: Tables,
): TableSchemas<Tables> => {
	const result: Record<string, Schema.Schema.AnyNoContext> = {};
	for (const [tableName, tableDef] of Object.entries(tables)) {
		result[tableName] = tableDef.tableSchema;
	}
	return result as TableSchemas<Tables>;
};

export type RpcResultEncoded<Success, Error> =
	| { readonly _tag: "success"; readonly value: Success }
	| { readonly _tag: "failure"; readonly error: Error }
	| { readonly _tag: "die"; readonly defect: unknown };

const RpcResultValidator = v.union(
	v.object({ _tag: v.literal("success"), value: v.any() }),
	v.object({ _tag: v.literal("failure"), error: v.any() }),
	v.object({ _tag: v.literal("die"), defect: v.any() }),
);

export interface RpcQueryDefinition<
	PayloadSchema extends Schema.Schema.AnyNoContext | undefined,
	SuccessSchema extends Schema.Schema.AnyNoContext,
	ErrorSchema extends Schema.Schema.AnyNoContext | undefined,
> {
	readonly _tag: "query";
	readonly payload?: PayloadSchema;
	readonly success: SuccessSchema;
	readonly error?: ErrorSchema;
	readonly handler: (
		args: PayloadSchema extends Schema.Schema.AnyNoContext
			? PayloadSchema["Type"]
			: void,
	) => Effect.Effect<
		SuccessSchema["Type"],
		ErrorSchema extends Schema.Schema.AnyNoContext ? ErrorSchema["Type"] : never,
		ConfectQueryCtx<GenericConfectSchema>
	>;
}

export interface RpcMutationDefinition<
	PayloadSchema extends Schema.Schema.AnyNoContext | undefined,
	SuccessSchema extends Schema.Schema.AnyNoContext,
	ErrorSchema extends Schema.Schema.AnyNoContext | undefined,
> {
	readonly _tag: "mutation";
	readonly payload?: PayloadSchema;
	readonly success: SuccessSchema;
	readonly error?: ErrorSchema;
	readonly handler: (
		args: PayloadSchema extends Schema.Schema.AnyNoContext
			? PayloadSchema["Type"]
			: void,
	) => Effect.Effect<
		SuccessSchema["Type"],
		ErrorSchema extends Schema.Schema.AnyNoContext ? ErrorSchema["Type"] : never,
		ConfectMutationCtx<GenericConfectSchema>
	>;
}

export type RpcDefinition =
	| RpcQueryDefinition<
			Schema.Schema.AnyNoContext | undefined,
			Schema.Schema.AnyNoContext,
			Schema.Schema.AnyNoContext | undefined
	  >
	| RpcMutationDefinition<
			Schema.Schema.AnyNoContext | undefined,
			Schema.Schema.AnyNoContext,
			Schema.Schema.AnyNoContext | undefined
	  >;

export type RpcDefinitions = Record<string, RpcDefinition>;

interface RpcFactoryQueryOptions<
	PayloadSchema extends Schema.Schema.AnyNoContext | undefined,
	SuccessSchema extends Schema.Schema.AnyNoContext,
	ErrorSchema extends Schema.Schema.AnyNoContext | undefined,
> {
	readonly payload?: PayloadSchema;
	readonly success: SuccessSchema;
	readonly error?: ErrorSchema;
}

interface RpcFactoryMutationOptions<
	PayloadSchema extends Schema.Schema.AnyNoContext | undefined,
	SuccessSchema extends Schema.Schema.AnyNoContext,
	ErrorSchema extends Schema.Schema.AnyNoContext | undefined,
> {
	readonly payload?: PayloadSchema;
	readonly success: SuccessSchema;
	readonly error?: ErrorSchema;
}

export interface RpcFactory<Tables extends GenericConfectSchema> {
	query<
		PayloadSchema extends Schema.Schema.AnyNoContext | undefined,
		SuccessSchema extends Schema.Schema.AnyNoContext,
		ErrorSchema extends Schema.Schema.AnyNoContext | undefined = undefined,
	>(
		options: RpcFactoryQueryOptions<PayloadSchema, SuccessSchema, ErrorSchema>,
		handler: (
			args: PayloadSchema extends Schema.Schema.AnyNoContext
				? PayloadSchema["Type"]
				: void,
		) => Effect.Effect<
			SuccessSchema["Type"],
			ErrorSchema extends Schema.Schema.AnyNoContext ? ErrorSchema["Type"] : never,
			ConfectQueryCtx<Tables>
		>,
	): RpcQueryDefinition<PayloadSchema, SuccessSchema, ErrorSchema>;

	mutation<
		PayloadSchema extends Schema.Schema.AnyNoContext | undefined,
		SuccessSchema extends Schema.Schema.AnyNoContext,
		ErrorSchema extends Schema.Schema.AnyNoContext | undefined = undefined,
	>(
		options: RpcFactoryMutationOptions<PayloadSchema, SuccessSchema, ErrorSchema>,
		handler: (
			args: PayloadSchema extends Schema.Schema.AnyNoContext
				? PayloadSchema["Type"]
				: void,
		) => Effect.Effect<
			SuccessSchema["Type"],
			ErrorSchema extends Schema.Schema.AnyNoContext ? ErrorSchema["Type"] : never,
			ConfectMutationCtx<Tables>
		>,
	): RpcMutationDefinition<PayloadSchema, SuccessSchema, ErrorSchema>;
}

export const createRpcFactory = <Tables extends GenericConfectSchema>(_options: {
	schema: ConfectSchemaDefinition<Tables>;
}): RpcFactory<Tables> => {
	return {
		query: <
			PayloadSchema extends Schema.Schema.AnyNoContext | undefined,
			SuccessSchema extends Schema.Schema.AnyNoContext,
			ErrorSchema extends Schema.Schema.AnyNoContext | undefined = undefined,
		>(
			options: RpcFactoryQueryOptions<PayloadSchema, SuccessSchema, ErrorSchema>,
			handler: (
				args: PayloadSchema extends Schema.Schema.AnyNoContext
					? PayloadSchema["Type"]
					: void,
			) => Effect.Effect<
				SuccessSchema["Type"],
				ErrorSchema extends Schema.Schema.AnyNoContext ? ErrorSchema["Type"] : never,
				ConfectQueryCtx<Tables>
			>,
		): RpcQueryDefinition<PayloadSchema, SuccessSchema, ErrorSchema> => ({
			_tag: "query",
			payload: options.payload,
			success: options.success,
			error: options.error,
			handler: handler as RpcQueryDefinition<
				PayloadSchema,
				SuccessSchema,
				ErrorSchema
			>["handler"],
		}),

		mutation: <
			PayloadSchema extends Schema.Schema.AnyNoContext | undefined,
			SuccessSchema extends Schema.Schema.AnyNoContext,
			ErrorSchema extends Schema.Schema.AnyNoContext | undefined = undefined,
		>(
			options: RpcFactoryMutationOptions<PayloadSchema, SuccessSchema, ErrorSchema>,
			handler: (
				args: PayloadSchema extends Schema.Schema.AnyNoContext
					? PayloadSchema["Type"]
					: void,
			) => Effect.Effect<
				SuccessSchema["Type"],
				ErrorSchema extends Schema.Schema.AnyNoContext ? ErrorSchema["Type"] : never,
				ConfectMutationCtx<Tables>
			>,
		): RpcMutationDefinition<PayloadSchema, SuccessSchema, ErrorSchema> => ({
			_tag: "mutation",
			payload: options.payload,
			success: options.success,
			error: options.error,
			handler: handler as RpcMutationDefinition<
				PayloadSchema,
				SuccessSchema,
				ErrorSchema
			>["handler"],
		}),
	};
};

type RegisteredHandlers<Defs extends RpcDefinitions> = {
	[K in keyof Defs]: Defs[K] extends RpcQueryDefinition<
		infer _P,
		infer _S,
		infer _E
	>
		? RegisteredQuery<"public", DefaultFunctionArgs, Promise<RpcResultEncoded<unknown, unknown>>>
		: Defs[K] extends RpcMutationDefinition<infer _P, infer _S, infer _E>
			? RegisteredMutation<"public", DefaultFunctionArgs, Promise<RpcResultEncoded<unknown, unknown>>>
			: never;
};

export interface RpcModule<Defs extends RpcDefinitions> {
	readonly definitions: Defs;
	readonly handlers: RegisteredHandlers<Defs>;
}

export const makeRpcModule = <
	Tables extends GenericConfectSchema,
	Defs extends RpcDefinitions,
>(
	schema: ConfectSchemaDefinition<Tables>,
	definitions: Defs,
): RpcModule<Defs> => {
	const tableSchemas = buildTableSchemas(schema.tables);
	const handlers = {} as Record<string, RegisteredQuery<"public", DefaultFunctionArgs, Promise<RpcResultEncoded<unknown, unknown>>> | RegisteredMutation<"public", DefaultFunctionArgs, Promise<RpcResultEncoded<unknown, unknown>>>>;

	for (const [name, def] of Object.entries(definitions)) {
		if (def._tag === "query") {
			handlers[name] = makeQueryHandler(def, tableSchemas);
		} else {
			handlers[name] = makeMutationHandler(def, tableSchemas);
		}
	}

	return {
		definitions,
		handlers: handlers as RegisteredHandlers<Defs>,
	};
};

const makeQueryHandler = <Tables extends GenericConfectSchema>(
	def: RpcQueryDefinition<
		Schema.Schema.AnyNoContext | undefined,
		Schema.Schema.AnyNoContext,
		Schema.Schema.AnyNoContext | undefined
	>,
	tableSchemas: TableSchemas<Tables>,
): RegisteredQuery<"public", DefaultFunctionArgs, Promise<RpcResultEncoded<unknown, unknown>>> => {
	const payloadValidator = def.payload
		? schemaToArgsValidator(Schema.Struct({ payload: def.payload }))
		: { payload: v.optional(v.null()) };

	return queryGeneric({
		args: payloadValidator,
		returns: RpcResultValidator,
		handler: async (
			ctx: GenericQueryCtx<GenericDataModel>,
			args: DefaultFunctionArgs,
		): Promise<RpcResultEncoded<unknown, unknown>> => {
			const confectCtx = makeQueryCtx(ctx, tableSchemas);

			const decodedPayload = def.payload
				? Schema.decodeUnknownSync(def.payload)(args.payload)
				: undefined;

			const effect = pipe(
				def.handler(decodedPayload) as Effect.Effect<unknown, unknown, never>,
				Effect.flatMap((result) => Schema.encode(def.success)(result)),
			);

			const exit = await Effect.runPromiseExit(
				Effect.provideService(effect, ConfectQueryCtx<GenericConfectSchema>(), confectCtx),
			);

			return Exit.match(exit, {
				onSuccess: (value): RpcResultEncoded<unknown, unknown> => ({
					_tag: "success",
					value,
				}),
				onFailure: (cause): RpcResultEncoded<unknown, unknown> => {
					const failure = Cause.failureOption(cause);
					if (failure._tag === "Some" && def.error) {
						try {
							const encodedError = Schema.encodeSync(def.error)(failure.value);
							return { _tag: "failure", error: encodedError };
						} catch {
							return { _tag: "die", defect: Cause.squash(cause) };
						}
					}
					return { _tag: "die", defect: Cause.squash(cause) };
				},
			});
		},
	});
};

const makeMutationHandler = <Tables extends GenericConfectSchema>(
	def: RpcMutationDefinition<
		Schema.Schema.AnyNoContext | undefined,
		Schema.Schema.AnyNoContext,
		Schema.Schema.AnyNoContext | undefined
	>,
	tableSchemas: TableSchemas<Tables>,
): RegisteredMutation<"public", DefaultFunctionArgs, Promise<RpcResultEncoded<unknown, unknown>>> => {
	const payloadValidator = def.payload
		? schemaToArgsValidator(Schema.Struct({ payload: def.payload }))
		: { payload: v.optional(v.null()) };

	return mutationGeneric({
		args: payloadValidator,
		returns: RpcResultValidator,
		handler: async (
			ctx: GenericMutationCtx<GenericDataModel>,
			args: DefaultFunctionArgs,
		): Promise<RpcResultEncoded<unknown, unknown>> => {
			const confectCtx = makeMutationCtx(ctx, tableSchemas);

			const decodedPayload = def.payload
				? Schema.decodeUnknownSync(def.payload)(args.payload)
				: undefined;

			const effect = pipe(
				def.handler(decodedPayload) as Effect.Effect<unknown, unknown, never>,
				Effect.flatMap((result) => Schema.encode(def.success)(result)),
			);

			const exit = await Effect.runPromiseExit(
				Effect.provideService(effect, ConfectMutationCtx<GenericConfectSchema>(), confectCtx),
			);

			return Exit.match(exit, {
				onSuccess: (value): RpcResultEncoded<unknown, unknown> => ({
					_tag: "success",
					value,
				}),
				onFailure: (cause): RpcResultEncoded<unknown, unknown> => {
					const failure = Cause.failureOption(cause);
					if (failure._tag === "Some" && def.error) {
						try {
							const encodedError = Schema.encodeSync(def.error)(failure.value);
							return { _tag: "failure", error: encodedError };
						} catch {
							return { _tag: "die", defect: Cause.squash(cause) };
						}
					}
					return { _tag: "die", defect: Cause.squash(cause) };
				},
			});
		},
	});
};

export type InferRpcPayload<D> = D extends RpcQueryDefinition<
	infer P,
	infer _S,
	infer _E
>
	? P extends Schema.Schema.AnyNoContext
		? P["Type"]
		: void
	: D extends RpcMutationDefinition<infer P, infer _S, infer _E>
		? P extends Schema.Schema.AnyNoContext
			? P["Type"]
			: void
		: never;

export type InferRpcSuccess<D> = D extends RpcQueryDefinition<
	infer _P,
	infer S,
	infer _E
>
	? S["Type"]
	: D extends RpcMutationDefinition<infer _P, infer S, infer _E>
		? S["Type"]
		: never;

export type InferRpcError<D> = D extends RpcQueryDefinition<
	infer _P,
	infer _S,
	infer E
>
	? E extends Schema.Schema.AnyNoContext
		? E["Type"]
		: never
	: D extends RpcMutationDefinition<infer _P, infer _S, infer E>
		? E extends Schema.Schema.AnyNoContext
			? E["Type"]
			: never
		: never;
