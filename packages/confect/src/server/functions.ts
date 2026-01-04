import {
	actionGeneric,
	type DefaultFunctionArgs,
	type GenericActionCtx,
	type GenericMutationCtx,
	type GenericQueryCtx,
	internalActionGeneric,
	internalMutationGeneric,
	internalQueryGeneric,
	mutationGeneric,
	queryGeneric,
	type RegisteredAction,
	type RegisteredMutation,
	type RegisteredQuery,
} from "convex/server";
import { Effect, Exit, pipe, Schema } from "effect";

import {
	ConfectActionCtx,
	ConfectMutationCtx,
	ConfectQueryCtx,
	makeConfectActionCtx,
	makeConfectMutationCtx,
	makeConfectQueryCtx,
} from "./ctx";
import type {
	DataModelFromConfectDataModel,
	GenericConfectDataModel,
} from "./data-model";
import {
	type DatabaseSchemasFromConfectDataModel,
	databaseSchemasFromConfectSchema,
} from "./database";
import type {
	ConfectDataModelFromConfectSchema,
	ConfectSchemaDefinition,
	GenericConfectSchema,
} from "./schema";
import { compileArgsSchema, compileReturnsSchema } from "./schema-to-validator";

type MutationBuilder = typeof mutationGeneric;
type InternalMutationBuilder = typeof internalMutationGeneric;

export interface MakeFunctionsOptions {
	mutationBuilder?: MutationBuilder;
	internalMutationBuilder?: InternalMutationBuilder;
}

export const makeFunctions = <ConfectSchema extends GenericConfectSchema>(
	confectSchemaDefinition: ConfectSchemaDefinition<ConfectSchema>,
	options?: MakeFunctionsOptions,
) => {
	const databaseSchemas = databaseSchemasFromConfectSchema(
		confectSchemaDefinition.confectSchema,
	);

	const mutationBuilder = options?.mutationBuilder ?? mutationGeneric;
	const internalMutationBuilder =
		options?.internalMutationBuilder ?? internalMutationGeneric;

	function query<
		ConvexArgs extends DefaultFunctionArgs,
		ConfectArgs,
		ConvexReturns,
		ConfectReturns,
	>(config: {
		args: Schema.Schema<ConfectArgs, ConvexArgs>;
		returns: Schema.Schema<ConfectReturns, ConvexReturns>;
		handler: (
			a: ConfectArgs,
		) => Effect.Effect<
			ConfectReturns,
			never,
			ConfectQueryCtx<ConfectDataModelFromConfectSchema<ConfectSchema>>
		>;
	}): RegisteredQuery<"public", ConvexArgs, Promise<ConvexReturns>>;

	function query<
		ConvexArgs extends DefaultFunctionArgs,
		ConfectArgs,
		ConvexReturns,
		ConfectReturns,
		ConvexError,
		ConfectError extends { readonly _tag: string },
	>(config: {
		args: Schema.Schema<ConfectArgs, ConvexArgs>;
		success: Schema.Schema<ConfectReturns, ConvexReturns>;
		error: Schema.Schema<ConfectError, ConvexError>;
		handler: (
			a: ConfectArgs,
		) => Effect.Effect<
			ConfectReturns,
			ConfectError,
			ConfectQueryCtx<ConfectDataModelFromConfectSchema<ConfectSchema>>
		>;
	}): RegisteredQuery<
		"public",
		ConvexArgs,
		Promise<Schema.ExitEncoded<ConvexReturns, ConvexError, unknown>>
	>;

	function query(
		config:
			| {
					args: Schema.Schema<unknown, DefaultFunctionArgs>;
					returns: Schema.Schema<unknown, unknown>;
					handler: (
						a: unknown,
					) => Effect.Effect<
						unknown,
						never,
						ConfectQueryCtx<ConfectDataModelFromConfectSchema<ConfectSchema>>
					>;
			  }
			| {
					args: Schema.Schema<unknown, DefaultFunctionArgs>;
					success: Schema.Schema<unknown, unknown>;
					error: Schema.Schema<{ readonly _tag: string }, unknown>;
					handler: (
						a: unknown,
					) => Effect.Effect<
						unknown,
						{ readonly _tag: string },
						ConfectQueryCtx<ConfectDataModelFromConfectSchema<ConfectSchema>>
					>;
			  },
	): RegisteredQuery<"public", DefaultFunctionArgs, Promise<unknown>> {
		if ("returns" in config) {
			return queryGeneric(
				confectQueryFunctionDirect({
					databaseSchemas,
					args: config.args,
					returns: config.returns,
					handler: config.handler,
				}),
			);
		}

		return queryGeneric(
			confectQueryFunctionWithResult({
				databaseSchemas,
				args: config.args,
				success: config.success,
				error: config.error,
				handler: config.handler,
			}),
		);
	}

	const internalQuery = <
		ConvexArgs extends DefaultFunctionArgs,
		ConfectArgs,
		ConvexReturns,
		ConfectReturns,
	>({
		args,
		returns,
		handler,
	}: {
		args: Schema.Schema<ConfectArgs, ConvexArgs>;
		returns: Schema.Schema<ConfectReturns, ConvexReturns>;
		handler: (
			a: ConfectArgs,
		) => Effect.Effect<
			ConfectReturns,
			never,
			ConfectQueryCtx<ConfectDataModelFromConfectSchema<ConfectSchema>>
		>;
	}): RegisteredQuery<"internal", ConvexArgs, Promise<ConvexReturns>> =>
		internalQueryGeneric(
			confectQueryFunctionDirect({
				databaseSchemas,
				args,
				returns: returns as Schema.Schema<unknown, ConvexReturns>,
				handler: handler as (
					a: unknown,
				) => Effect.Effect<
					unknown,
					never,
					ConfectQueryCtx<ConfectDataModelFromConfectSchema<ConfectSchema>>
				>,
			}),
		);

	function mutation<
		ConvexValue extends DefaultFunctionArgs,
		ConfectValue,
		ConvexReturns,
		ConfectReturns,
	>(config: {
		args: Schema.Schema<ConfectValue, ConvexValue>;
		returns: Schema.Schema<ConfectReturns, ConvexReturns>;
		handler: (
			a: ConfectValue,
		) => Effect.Effect<
			ConfectReturns,
			never,
			ConfectMutationCtx<ConfectDataModelFromConfectSchema<ConfectSchema>>
		>;
	}): RegisteredMutation<"public", ConvexValue, Promise<ConvexReturns>>;

	function mutation<
		ConvexValue extends DefaultFunctionArgs,
		ConfectValue,
		ConvexReturns,
		ConfectReturns,
		ConvexError,
		ConfectError extends { readonly _tag: string },
	>(config: {
		args: Schema.Schema<ConfectValue, ConvexValue>;
		success: Schema.Schema<ConfectReturns, ConvexReturns>;
		error: Schema.Schema<ConfectError, ConvexError>;
		handler: (
			a: ConfectValue,
		) => Effect.Effect<
			ConfectReturns,
			ConfectError,
			ConfectMutationCtx<ConfectDataModelFromConfectSchema<ConfectSchema>>
		>;
	}): RegisteredMutation<
		"public",
		ConvexValue,
		Promise<Schema.ExitEncoded<ConvexReturns, ConvexError, unknown>>
	>;

	function mutation(
		config:
			| {
					args: Schema.Schema<unknown, DefaultFunctionArgs>;
					returns: Schema.Schema<unknown, unknown>;
					handler: (
						a: unknown,
					) => Effect.Effect<
						unknown,
						never,
						ConfectMutationCtx<ConfectDataModelFromConfectSchema<ConfectSchema>>
					>;
			  }
			| {
					args: Schema.Schema<unknown, DefaultFunctionArgs>;
					success: Schema.Schema<unknown, unknown>;
					error: Schema.Schema<{ readonly _tag: string }, unknown>;
					handler: (
						a: unknown,
					) => Effect.Effect<
						unknown,
						{ readonly _tag: string },
						ConfectMutationCtx<ConfectDataModelFromConfectSchema<ConfectSchema>>
					>;
			  },
	): RegisteredMutation<"public", DefaultFunctionArgs, Promise<unknown>> {
		if ("returns" in config) {
			return mutationBuilder(
				confectMutationFunctionDirect({
					databaseSchemas,
					args: config.args,
					returns: config.returns,
					handler: config.handler,
				}),
			);
		}

		return mutationBuilder(
			confectMutationFunctionWithResult({
				databaseSchemas,
				args: config.args,
				success: config.success,
				error: config.error,
				handler: config.handler,
			}),
		);
	}

	const internalMutation = <
		ConvexValue extends DefaultFunctionArgs,
		ConfectValue,
		ConvexReturns,
		ConfectReturns,
	>({
		args,
		returns,
		handler,
	}: {
		args: Schema.Schema<ConfectValue, ConvexValue>;
		returns: Schema.Schema<ConfectReturns, ConvexReturns>;
		handler: (
			a: ConfectValue,
		) => Effect.Effect<
			ConfectReturns,
			never,
			ConfectMutationCtx<ConfectDataModelFromConfectSchema<ConfectSchema>>
		>;
	}): RegisteredMutation<"internal", ConvexValue, Promise<ConvexReturns>> =>
		internalMutationBuilder(
			confectMutationFunctionDirect({
				databaseSchemas,
				args,
				returns: returns as Schema.Schema<unknown, ConvexReturns>,
				handler: handler as (
					a: unknown,
				) => Effect.Effect<
					unknown,
					never,
					ConfectMutationCtx<ConfectDataModelFromConfectSchema<ConfectSchema>>
				>,
			}),
		);

	function action<
		ConvexValue extends DefaultFunctionArgs,
		ConfectValue,
		ConvexReturns,
		ConfectReturns,
	>(config: {
		args: Schema.Schema<ConfectValue, ConvexValue>;
		returns: Schema.Schema<ConfectReturns, ConvexReturns>;
		handler: (
			a: ConfectValue,
		) => Effect.Effect<
			ConfectReturns,
			never,
			ConfectActionCtx<ConfectDataModelFromConfectSchema<ConfectSchema>>
		>;
	}): RegisteredAction<"public", ConvexValue, Promise<ConvexReturns>>;

	function action<
		ConvexValue extends DefaultFunctionArgs,
		ConfectValue,
		ConvexReturns,
		ConfectReturns,
		ConvexError,
		ConfectError extends { readonly _tag: string },
	>(config: {
		args: Schema.Schema<ConfectValue, ConvexValue>;
		success: Schema.Schema<ConfectReturns, ConvexReturns>;
		error: Schema.Schema<ConfectError, ConvexError>;
		handler: (
			a: ConfectValue,
		) => Effect.Effect<
			ConfectReturns,
			ConfectError,
			ConfectActionCtx<ConfectDataModelFromConfectSchema<ConfectSchema>>
		>;
	}): RegisteredAction<
		"public",
		ConvexValue,
		Promise<Schema.ExitEncoded<ConvexReturns, ConvexError, unknown>>
	>;

	function action(
		config:
			| {
					args: Schema.Schema<unknown, DefaultFunctionArgs>;
					returns: Schema.Schema<unknown, unknown>;
					handler: (
						a: unknown,
					) => Effect.Effect<
						unknown,
						never,
						ConfectActionCtx<ConfectDataModelFromConfectSchema<ConfectSchema>>
					>;
			  }
			| {
					args: Schema.Schema<unknown, DefaultFunctionArgs>;
					success: Schema.Schema<unknown, unknown>;
					error: Schema.Schema<{ readonly _tag: string }, unknown>;
					handler: (
						a: unknown,
					) => Effect.Effect<
						unknown,
						{ readonly _tag: string },
						ConfectActionCtx<ConfectDataModelFromConfectSchema<ConfectSchema>>
					>;
			  },
	): RegisteredAction<"public", DefaultFunctionArgs, Promise<unknown>> {
		if ("returns" in config) {
			return actionGeneric(
				confectActionFunctionDirect({
					args: config.args,
					returns: config.returns,
					handler: config.handler,
				}),
			);
		}

		return actionGeneric(
			confectActionFunctionWithResult({
				args: config.args,
				success: config.success,
				error: config.error,
				handler: config.handler,
			}),
		);
	}

	const internalAction = <
		ConvexValue extends DefaultFunctionArgs,
		ConfectValue,
		ConvexReturns,
		ConfectReturns,
	>({
		args,
		returns,
		handler,
	}: {
		args: Schema.Schema<ConfectValue, ConvexValue>;
		returns: Schema.Schema<ConfectReturns, ConvexReturns>;
		handler: (
			a: ConfectValue,
		) => Effect.Effect<
			ConfectReturns,
			never,
			ConfectActionCtx<ConfectDataModelFromConfectSchema<ConfectSchema>>
		>;
	}): RegisteredAction<"internal", ConvexValue, Promise<ConvexReturns>> =>
		internalActionGeneric(
			confectActionFunctionDirect({
				args,
				returns: returns as Schema.Schema<unknown, ConvexReturns>,
				handler: handler as (
					a: unknown,
				) => Effect.Effect<
					unknown,
					never,
					ConfectActionCtx<ConfectDataModelFromConfectSchema<ConfectSchema>>
				>,
			}),
		);

	return {
		query,
		internalQuery,
		mutation,
		internalMutation,
		action,
		internalAction,
	};
};

const confectQueryFunctionDirect = <
	ConfectDataModel extends GenericConfectDataModel,
	ConvexArgs extends DefaultFunctionArgs,
	ConfectArgs,
	ConvexReturns,
	ConfectReturns,
>({
	databaseSchemas,
	args,
	returns,
	handler,
}: {
	databaseSchemas: DatabaseSchemasFromConfectDataModel<ConfectDataModel>;
	args: Schema.Schema<ConfectArgs, ConvexArgs>;
	returns: Schema.Schema<ConfectReturns, ConvexReturns>;
	handler: (
		a: ConfectArgs,
	) => Effect.Effect<ConfectReturns, never, ConfectQueryCtx<ConfectDataModel>>;
}) => ({
	args: compileArgsSchema(args),
	returns: compileReturnsSchema(returns),
	handler: (
		ctx: GenericQueryCtx<DataModelFromConfectDataModel<ConfectDataModel>>,
		actualArgs: ConvexArgs,
	): Promise<ConvexReturns> =>
		pipe(
			actualArgs,
			Schema.decode(args),
			Effect.orDie,
			Effect.andThen((decodedArgs) =>
				handler(decodedArgs).pipe(
					Effect.provideService(
						ConfectQueryCtx<ConfectDataModel>(),
						makeConfectQueryCtx(ctx, databaseSchemas),
					),
				),
			),
			Effect.andThen((result) => Schema.encode(returns)(result)),
			Effect.runPromise,
		),
});

const confectQueryFunctionWithResult = <
	ConfectDataModel extends GenericConfectDataModel,
	ConvexArgs extends DefaultFunctionArgs,
	ConfectArgs,
	ConvexSuccess,
	ConfectSuccess,
	ConvexError,
	ConfectError extends { readonly _tag: string },
>({
	databaseSchemas,
	args,
	success,
	error,
	handler,
}: {
	databaseSchemas: DatabaseSchemasFromConfectDataModel<ConfectDataModel>;
	args: Schema.Schema<ConfectArgs, ConvexArgs>;
	success: Schema.Schema<ConfectSuccess, ConvexSuccess>;
	error: Schema.Schema<ConfectError, ConvexError>;
	handler: (
		a: ConfectArgs,
	) => Effect.Effect<
		ConfectSuccess,
		ConfectError,
		ConfectQueryCtx<ConfectDataModel>
	>;
}) => {
	const exitSchema = Schema.Exit({
		success,
		failure: error,
		defect: Schema.Defect,
	});

	return {
		args: compileArgsSchema(args),
		returns: compileReturnsSchema(exitSchema),
		handler: (
			ctx: GenericQueryCtx<DataModelFromConfectDataModel<ConfectDataModel>>,
			actualArgs: ConvexArgs,
		): Promise<Schema.ExitEncoded<ConvexSuccess, ConvexError, unknown>> =>
			pipe(
				actualArgs,
				Schema.decode(args),
				Effect.orDie,
				Effect.andThen((decodedArgs) =>
					handler(decodedArgs).pipe(
						Effect.provideService(
							ConfectQueryCtx<ConfectDataModel>(),
							makeConfectQueryCtx(ctx, databaseSchemas),
						),
					),
				),
				Effect.exit,
				Effect.andThen((exit) => Schema.encode(exitSchema)(exit)),
				Effect.runPromise,
			),
	};
};

const confectMutationFunctionDirect = <
	ConfectDataModel extends GenericConfectDataModel,
	ConvexValue extends DefaultFunctionArgs,
	ConfectValue,
	ConvexReturns,
	ConfectReturns,
>({
	databaseSchemas,
	args,
	returns,
	handler,
}: {
	databaseSchemas: DatabaseSchemasFromConfectDataModel<ConfectDataModel>;
	args: Schema.Schema<ConfectValue, ConvexValue>;
	returns: Schema.Schema<ConfectReturns, ConvexReturns>;
	handler: (
		a: ConfectValue,
	) => Effect.Effect<
		ConfectReturns,
		never,
		ConfectMutationCtx<ConfectDataModel>
	>;
}) => ({
	args: compileArgsSchema(args),
	returns: compileReturnsSchema(returns),
	handler: (
		ctx: GenericMutationCtx<DataModelFromConfectDataModel<ConfectDataModel>>,
		actualArgs: ConvexValue,
	): Promise<ConvexReturns> =>
		pipe(
			actualArgs,
			Schema.decode(args),
			Effect.orDie,
			Effect.andThen((decodedArgs) =>
				handler(decodedArgs).pipe(
					Effect.provideService(
						ConfectMutationCtx<ConfectDataModel>(),
						makeConfectMutationCtx(ctx, databaseSchemas),
					),
				),
			),
			Effect.andThen((result) => Schema.encode(returns)(result)),
			Effect.runPromise,
		),
});

const confectMutationFunctionWithResult = <
	ConfectDataModel extends GenericConfectDataModel,
	ConvexValue extends DefaultFunctionArgs,
	ConfectValue,
	ConvexSuccess,
	ConfectSuccess,
	ConvexError,
	ConfectError extends { readonly _tag: string },
>({
	databaseSchemas,
	args,
	success,
	error,
	handler,
}: {
	databaseSchemas: DatabaseSchemasFromConfectDataModel<ConfectDataModel>;
	args: Schema.Schema<ConfectValue, ConvexValue>;
	success: Schema.Schema<ConfectSuccess, ConvexSuccess>;
	error: Schema.Schema<ConfectError, ConvexError>;
	handler: (
		a: ConfectValue,
	) => Effect.Effect<
		ConfectSuccess,
		ConfectError,
		ConfectMutationCtx<ConfectDataModel>
	>;
}) => {
	const exitSchema = Schema.Exit({
		success,
		failure: error,
		defect: Schema.Defect,
	});

	return {
		args: compileArgsSchema(args),
		returns: compileReturnsSchema(exitSchema),
		handler: (
			ctx: GenericMutationCtx<DataModelFromConfectDataModel<ConfectDataModel>>,
			actualArgs: ConvexValue,
		): Promise<Schema.ExitEncoded<ConvexSuccess, ConvexError, unknown>> =>
			pipe(
				actualArgs,
				Schema.decode(args),
				Effect.orDie,
				Effect.andThen((decodedArgs) =>
					handler(decodedArgs).pipe(
						Effect.provideService(
							ConfectMutationCtx<ConfectDataModel>(),
							makeConfectMutationCtx(ctx, databaseSchemas),
						),
					),
				),
				Effect.exit,
				Effect.andThen((exit) => Schema.encode(exitSchema)(exit)),
				Effect.runPromise,
			),
	};
};

const confectActionFunctionDirect = <
	ConfectDataModel extends GenericConfectDataModel,
	ConvexValue extends DefaultFunctionArgs,
	ConfectValue,
	ConvexReturns,
	ConfectReturns,
>({
	args,
	returns,
	handler,
}: {
	args: Schema.Schema<ConfectValue, ConvexValue>;
	returns: Schema.Schema<ConfectReturns, ConvexReturns>;
	handler: (
		a: ConfectValue,
	) => Effect.Effect<ConfectReturns, never, ConfectActionCtx<ConfectDataModel>>;
}) => ({
	args: compileArgsSchema(args),
	returns: compileReturnsSchema(returns),
	handler: (
		ctx: GenericActionCtx<DataModelFromConfectDataModel<ConfectDataModel>>,
		actualArgs: ConvexValue,
	): Promise<ConvexReturns> =>
		pipe(
			actualArgs,
			Schema.decode(args),
			Effect.orDie,
			Effect.andThen((decodedArgs) =>
				handler(decodedArgs).pipe(
					Effect.provideService(
						ConfectActionCtx<ConfectDataModel>(),
						makeConfectActionCtx(ctx),
					),
				),
			),
			Effect.andThen((result) => Schema.encode(returns)(result)),
			Effect.runPromise,
		),
});

const confectActionFunctionWithResult = <
	ConfectDataModel extends GenericConfectDataModel,
	ConvexValue extends DefaultFunctionArgs,
	ConfectValue,
	ConvexSuccess,
	ConfectSuccess,
	ConvexError,
	ConfectError extends { readonly _tag: string },
>({
	args,
	success,
	error,
	handler,
}: {
	args: Schema.Schema<ConfectValue, ConvexValue>;
	success: Schema.Schema<ConfectSuccess, ConvexSuccess>;
	error: Schema.Schema<ConfectError, ConvexError>;
	handler: (
		a: ConfectValue,
	) => Effect.Effect<
		ConfectSuccess,
		ConfectError,
		ConfectActionCtx<ConfectDataModel>
	>;
}) => {
	const exitSchema = Schema.Exit({
		success,
		failure: error,
		defect: Schema.Defect,
	});

	return {
		args: compileArgsSchema(args),
		returns: compileReturnsSchema(exitSchema),
		handler: (
			ctx: GenericActionCtx<DataModelFromConfectDataModel<ConfectDataModel>>,
			actualArgs: ConvexValue,
		): Promise<Schema.ExitEncoded<ConvexSuccess, ConvexError, unknown>> =>
			pipe(
				actualArgs,
				Schema.decode(args),
				Effect.orDie,
				Effect.andThen((decodedArgs) =>
					handler(decodedArgs).pipe(
						Effect.provideService(
							ConfectActionCtx<ConfectDataModel>(),
							makeConfectActionCtx(ctx),
						),
					),
				),
				Effect.exit,
				Effect.andThen((exit) => Schema.encode(exitSchema)(exit)),
				Effect.runPromise,
			),
	};
};
