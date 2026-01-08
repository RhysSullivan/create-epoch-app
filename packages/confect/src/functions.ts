import {
	queryGeneric,
	mutationGeneric,
	actionGeneric,
	internalQueryGeneric,
	internalMutationGeneric,
	internalActionGeneric,
	type GenericQueryCtx,
	type GenericMutationCtx,
	type GenericActionCtx,
	type GenericDataModel,
	type DefaultFunctionArgs,
	type RegisteredQuery,
	type RegisteredMutation,
	type RegisteredAction,
} from "convex/server";
import type { PropertyValidators, Validator } from "convex/values";
import { Effect, Schema, Exit, Cause, pipe } from "effect";

import {
	ConfectQueryCtx,
	ConfectMutationCtx,
	ConfectActionCtx,
	makeQueryCtx,
	makeMutationCtx,
	makeActionCtx,
	type GenericConfectSchema,
	type TableNamesInSchema,
	type DocumentFromTable,
	type EncodedDocumentFromTable,
} from "./ctx";
import { schemaToArgsValidator, schemaToValidator } from "./validators";
import type { ConfectSchemaDefinition } from "./schema";

type TableSchemas<Tables extends GenericConfectSchema> = {
	[TableName in TableNamesInSchema<Tables>]: Schema.Schema<
		DocumentFromTable<Tables, TableName>,
		EncodedDocumentFromTable<Tables, TableName>
	>;
};

const SystemFieldsSchema = Schema.Struct({
	_id: Schema.String,
	_creationTime: Schema.Number,
});

const buildTableSchemas = <Tables extends GenericConfectSchema>(
	tables: Tables,
): TableSchemas<Tables> => {
	const result: Record<string, Schema.Schema.AnyNoContext> = {};
	for (const [tableName, tableDef] of Object.entries(tables)) {
		result[tableName] = Schema.extend(SystemFieldsSchema, tableDef.tableSchema);
	}
	return result as TableSchemas<Tables>;
};

export interface QueryOptions<
	ArgsSchema extends Schema.Schema.AnyNoContext,
	ReturnsSchema extends Schema.Schema.AnyNoContext,
> {
	args?: ArgsSchema;
	returns: ReturnsSchema;
}

export interface MutationOptions<
	ArgsSchema extends Schema.Schema.AnyNoContext,
	ReturnsSchema extends Schema.Schema.AnyNoContext,
> {
	args?: ArgsSchema;
	returns: ReturnsSchema;
}

export interface ActionOptions<
	ArgsSchema extends Schema.Schema.AnyNoContext,
	ReturnsSchema extends Schema.Schema.AnyNoContext,
> {
	args?: ArgsSchema;
	returns: ReturnsSchema;
}

export interface EffectFunctionBuilder<Tables extends GenericConfectSchema> {
	query<
		ArgsSchema extends Schema.Schema.AnyNoContext,
		ReturnsSchema extends Schema.Schema.AnyNoContext,
	>(
		options: QueryOptions<ArgsSchema, ReturnsSchema>,
		handler: (
			args: ArgsSchema["Type"],
		) => Effect.Effect<ReturnsSchema["Type"], unknown, ConfectQueryCtx<Tables>>,
	): RegisteredQuery<"public", ArgsSchema["Encoded"], Promise<ReturnsSchema["Encoded"]>>;

	mutation<
		ArgsSchema extends Schema.Schema.AnyNoContext,
		ReturnsSchema extends Schema.Schema.AnyNoContext,
	>(
		options: MutationOptions<ArgsSchema, ReturnsSchema>,
		handler: (
			args: ArgsSchema["Type"],
		) => Effect.Effect<ReturnsSchema["Type"], unknown, ConfectMutationCtx<Tables>>,
	): RegisteredMutation<"public", ArgsSchema["Encoded"], Promise<ReturnsSchema["Encoded"]>>;

	action<
		ArgsSchema extends Schema.Schema.AnyNoContext,
		ReturnsSchema extends Schema.Schema.AnyNoContext,
	>(
		options: ActionOptions<ArgsSchema, ReturnsSchema>,
		handler: (
			args: ArgsSchema["Type"],
		) => Effect.Effect<ReturnsSchema["Type"], unknown, ConfectActionCtx<Tables>>,
	): RegisteredAction<"public", ArgsSchema["Encoded"], Promise<ReturnsSchema["Encoded"]>>;

	internalQuery<
		ArgsSchema extends Schema.Schema.AnyNoContext,
		ReturnsSchema extends Schema.Schema.AnyNoContext,
	>(
		options: QueryOptions<ArgsSchema, ReturnsSchema>,
		handler: (
			args: ArgsSchema["Type"],
		) => Effect.Effect<ReturnsSchema["Type"], unknown, ConfectQueryCtx<Tables>>,
	): RegisteredQuery<"internal", ArgsSchema["Encoded"], Promise<ReturnsSchema["Encoded"]>>;

	internalMutation<
		ArgsSchema extends Schema.Schema.AnyNoContext,
		ReturnsSchema extends Schema.Schema.AnyNoContext,
	>(
		options: MutationOptions<ArgsSchema, ReturnsSchema>,
		handler: (
			args: ArgsSchema["Type"],
		) => Effect.Effect<ReturnsSchema["Type"], unknown, ConfectMutationCtx<Tables>>,
	): RegisteredMutation<"internal", ArgsSchema["Encoded"], Promise<ReturnsSchema["Encoded"]>>;

	internalAction<
		ArgsSchema extends Schema.Schema.AnyNoContext,
		ReturnsSchema extends Schema.Schema.AnyNoContext,
	>(
		options: ActionOptions<ArgsSchema, ReturnsSchema>,
		handler: (
			args: ArgsSchema["Type"],
		) => Effect.Effect<ReturnsSchema["Type"], unknown, ConfectActionCtx<Tables>>,
	): RegisteredAction<"internal", ArgsSchema["Encoded"], Promise<ReturnsSchema["Encoded"]>>;
}

export const createFunctions = <Tables extends GenericConfectSchema>(
	schema: ConfectSchemaDefinition<Tables>,
): EffectFunctionBuilder<Tables> => {
	const tableSchemas = buildTableSchemas(schema.tables);

	const emptyArgsSchema = Schema.Struct({});

	return {
		query: <
			ArgsSchema extends Schema.Schema.AnyNoContext,
			ReturnsSchema extends Schema.Schema.AnyNoContext,
		>(
			options: QueryOptions<ArgsSchema, ReturnsSchema>,
			handler: (
				args: ArgsSchema["Type"],
			) => Effect.Effect<ReturnsSchema["Type"], unknown, ConfectQueryCtx<Tables>>,
		) => {
			const argsSchema = options.args ?? emptyArgsSchema;
			const argsValidator = schemaToArgsValidator(argsSchema);
			const returnsValidator = schemaToValidator(options.returns);

			return queryGeneric({
				args: argsValidator,
				returns: returnsValidator as Validator<ReturnsSchema["Encoded"], "required", string>,
				handler: async (
					ctx: GenericQueryCtx<GenericDataModel>,
					args: DefaultFunctionArgs,
				): Promise<ReturnsSchema["Encoded"]> => {
					const decodedArgs = Schema.decodeUnknownSync(argsSchema)(args);
					const confectCtx = makeQueryCtx(ctx, tableSchemas);
					const effect = pipe(
						handler(decodedArgs),
						Effect.provideService(ConfectQueryCtx<Tables>(), confectCtx),
						Effect.flatMap((result) => Schema.encode(options.returns)(result)),
					);
					const exit = await Effect.runPromiseExit(effect);
					return Exit.match(exit, {
						onSuccess: (value) => value,
						onFailure: (cause) => {
							throw Cause.squash(cause);
						},
					});
				},
			});
		},

		mutation: <
			ArgsSchema extends Schema.Schema.AnyNoContext,
			ReturnsSchema extends Schema.Schema.AnyNoContext,
		>(
			options: MutationOptions<ArgsSchema, ReturnsSchema>,
			handler: (
				args: ArgsSchema["Type"],
			) => Effect.Effect<ReturnsSchema["Type"], unknown, ConfectMutationCtx<Tables>>,
		) => {
			const argsSchema = options.args ?? emptyArgsSchema;
			const argsValidator = schemaToArgsValidator(argsSchema);
			const returnsValidator = schemaToValidator(options.returns);

			return mutationGeneric({
				args: argsValidator,
				returns: returnsValidator as Validator<ReturnsSchema["Encoded"], "required", string>,
				handler: async (
					ctx: GenericMutationCtx<GenericDataModel>,
					args: DefaultFunctionArgs,
				): Promise<ReturnsSchema["Encoded"]> => {
					const decodedArgs = Schema.decodeUnknownSync(argsSchema)(args);
					const confectCtx = makeMutationCtx(ctx, tableSchemas);
					const effect = pipe(
						handler(decodedArgs),
						Effect.provideService(ConfectMutationCtx<Tables>(), confectCtx),
						Effect.flatMap((result) => Schema.encode(options.returns)(result)),
					);
					const exit = await Effect.runPromiseExit(effect);
					return Exit.match(exit, {
						onSuccess: (value) => value,
						onFailure: (cause) => {
							throw Cause.squash(cause);
						},
					});
				},
			});
		},

		action: <
			ArgsSchema extends Schema.Schema.AnyNoContext,
			ReturnsSchema extends Schema.Schema.AnyNoContext,
		>(
			options: ActionOptions<ArgsSchema, ReturnsSchema>,
			handler: (
				args: ArgsSchema["Type"],
			) => Effect.Effect<ReturnsSchema["Type"], unknown, ConfectActionCtx<Tables>>,
		) => {
			const argsSchema = options.args ?? emptyArgsSchema;
			const argsValidator = schemaToArgsValidator(argsSchema);
			const returnsValidator = schemaToValidator(options.returns);

			return actionGeneric({
				args: argsValidator,
				returns: returnsValidator as Validator<ReturnsSchema["Encoded"], "required", string>,
				handler: async (
					ctx: GenericActionCtx<GenericDataModel>,
					args: DefaultFunctionArgs,
				): Promise<ReturnsSchema["Encoded"]> => {
					const decodedArgs = Schema.decodeUnknownSync(argsSchema)(args);
					const confectCtx = makeActionCtx<Tables>(ctx);
					const effect = pipe(
						handler(decodedArgs),
						Effect.provideService(ConfectActionCtx<Tables>(), confectCtx),
						Effect.flatMap((result) => Schema.encode(options.returns)(result)),
					);
					const exit = await Effect.runPromiseExit(effect);
					return Exit.match(exit, {
						onSuccess: (value) => value,
						onFailure: (cause) => {
							throw Cause.squash(cause);
						},
					});
				},
			});
		},

		internalQuery: <
			ArgsSchema extends Schema.Schema.AnyNoContext,
			ReturnsSchema extends Schema.Schema.AnyNoContext,
		>(
			options: QueryOptions<ArgsSchema, ReturnsSchema>,
			handler: (
				args: ArgsSchema["Type"],
			) => Effect.Effect<ReturnsSchema["Type"], unknown, ConfectQueryCtx<Tables>>,
		) => {
			const argsSchema = options.args ?? emptyArgsSchema;
			const argsValidator = schemaToArgsValidator(argsSchema);
			const returnsValidator = schemaToValidator(options.returns);

			return internalQueryGeneric({
				args: argsValidator,
				returns: returnsValidator as Validator<ReturnsSchema["Encoded"], "required", string>,
				handler: async (
					ctx: GenericQueryCtx<GenericDataModel>,
					args: DefaultFunctionArgs,
				): Promise<ReturnsSchema["Encoded"]> => {
					const decodedArgs = Schema.decodeUnknownSync(argsSchema)(args);
					const confectCtx = makeQueryCtx(ctx, tableSchemas);
					const effect = pipe(
						handler(decodedArgs),
						Effect.provideService(ConfectQueryCtx<Tables>(), confectCtx),
						Effect.flatMap((result) => Schema.encode(options.returns)(result)),
					);
					const exit = await Effect.runPromiseExit(effect);
					return Exit.match(exit, {
						onSuccess: (value) => value,
						onFailure: (cause) => {
							throw Cause.squash(cause);
						},
					});
				},
			});
		},

		internalMutation: <
			ArgsSchema extends Schema.Schema.AnyNoContext,
			ReturnsSchema extends Schema.Schema.AnyNoContext,
		>(
			options: MutationOptions<ArgsSchema, ReturnsSchema>,
			handler: (
				args: ArgsSchema["Type"],
			) => Effect.Effect<ReturnsSchema["Type"], unknown, ConfectMutationCtx<Tables>>,
		) => {
			const argsSchema = options.args ?? emptyArgsSchema;
			const argsValidator = schemaToArgsValidator(argsSchema);
			const returnsValidator = schemaToValidator(options.returns);

			return internalMutationGeneric({
				args: argsValidator,
				returns: returnsValidator as Validator<ReturnsSchema["Encoded"], "required", string>,
				handler: async (
					ctx: GenericMutationCtx<GenericDataModel>,
					args: DefaultFunctionArgs,
				): Promise<ReturnsSchema["Encoded"]> => {
					const decodedArgs = Schema.decodeUnknownSync(argsSchema)(args);
					const confectCtx = makeMutationCtx(ctx, tableSchemas);
					const effect = pipe(
						handler(decodedArgs),
						Effect.provideService(ConfectMutationCtx<Tables>(), confectCtx),
						Effect.flatMap((result) => Schema.encode(options.returns)(result)),
					);
					const exit = await Effect.runPromiseExit(effect);
					return Exit.match(exit, {
						onSuccess: (value) => value,
						onFailure: (cause) => {
							throw Cause.squash(cause);
						},
					});
				},
			});
		},

		internalAction: <
			ArgsSchema extends Schema.Schema.AnyNoContext,
			ReturnsSchema extends Schema.Schema.AnyNoContext,
		>(
			options: ActionOptions<ArgsSchema, ReturnsSchema>,
			handler: (
				args: ArgsSchema["Type"],
			) => Effect.Effect<ReturnsSchema["Type"], unknown, ConfectActionCtx<Tables>>,
		) => {
			const argsSchema = options.args ?? emptyArgsSchema;
			const argsValidator = schemaToArgsValidator(argsSchema);
			const returnsValidator = schemaToValidator(options.returns);

			return internalActionGeneric({
				args: argsValidator,
				returns: returnsValidator as Validator<ReturnsSchema["Encoded"], "required", string>,
				handler: async (
					ctx: GenericActionCtx<GenericDataModel>,
					args: DefaultFunctionArgs,
				): Promise<ReturnsSchema["Encoded"]> => {
					const decodedArgs = Schema.decodeUnknownSync(argsSchema)(args);
					const confectCtx = makeActionCtx<Tables>(ctx);
					const effect = pipe(
						handler(decodedArgs),
						Effect.provideService(ConfectActionCtx<Tables>(), confectCtx),
						Effect.flatMap((result) => Schema.encode(options.returns)(result)),
					);
					const exit = await Effect.runPromiseExit(effect);
					return Exit.match(exit, {
						onSuccess: (value) => value,
						onFailure: (cause) => {
							throw Cause.squash(cause);
						},
					});
				},
			});
		},
	};
};
