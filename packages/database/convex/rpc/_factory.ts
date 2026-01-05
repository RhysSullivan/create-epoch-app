import type { Rpc } from "@effect/rpc";
import {
	AuthenticatedUser,
	AuthenticationError,
	AuthMiddleware,
	createAuthMiddleware,
} from "@packages/api/middleware";
import {
	query,
	mutation,
	action,
	internalQuery,
	internalMutation,
	internalAction,
	type RpcHandlerOptions,
} from "@packages/confect/convex";
import { Context, Effect } from "effect";

import {
	confectSchema,
	type ConfectQueryCtx,
	type ConfectMutationCtx,
	type ConfectActionCtx,
} from "../confect";

const VALID_ACCESS_KEY = process.env.PRIVATE_ACCESS_KEY ?? "test-key";

const authImpl = createAuthMiddleware((token) =>
	token === VALID_ACCESS_KEY
		? Effect.succeed({ id: "system", email: "system@example.com" })
		: Effect.fail(new AuthenticationError({ message: "Invalid access key" })),
);

const authMiddleware: RpcHandlerOptions = {
	middleware: Context.make(AuthMiddleware, authImpl),
};

type AuthQueryHandler<R extends Rpc.Any> = (
	payload: Rpc.Payload<R>,
) => Effect.Effect<
	Rpc.Success<R>,
	Rpc.Error<R>,
	ConfectQueryCtx | AuthenticatedUser
>;

type AuthMutationHandler<R extends Rpc.Any> = (
	payload: Rpc.Payload<R>,
) => Effect.Effect<
	Rpc.Success<R>,
	Rpc.Error<R>,
	ConfectMutationCtx | AuthenticatedUser
>;

type AuthActionHandler<R extends Rpc.Any> = (
	payload: Rpc.Payload<R>,
) => Effect.Effect<
	Rpc.Success<R>,
	Rpc.Error<R>,
	ConfectActionCtx | AuthenticatedUser
>;

type HandlerFn<R extends Rpc.Any, Ctx> = (
	payload: Rpc.Payload<R>,
) => Effect.Effect<Rpc.Success<R>, Rpc.Error<R>, Ctx>;

export const rpcQuery = <R extends Rpc.Any>(
	rpc: R,
	handler: AuthQueryHandler<R>,
) =>
	query(
		confectSchema,
		rpc,
		handler as HandlerFn<R, ConfectQueryCtx>,
		authMiddleware,
	);

export const rpcMutation = <R extends Rpc.Any>(
	rpc: R,
	handler: AuthMutationHandler<R>,
) =>
	mutation(
		confectSchema,
		rpc,
		handler as HandlerFn<R, ConfectMutationCtx>,
		authMiddleware,
	);

export const rpcAction = <R extends Rpc.Any>(
	rpc: R,
	handler: AuthActionHandler<R>,
) =>
	action(
		confectSchema,
		rpc,
		handler as HandlerFn<R, ConfectActionCtx>,
		authMiddleware,
	);

export const rpcInternalQuery = <R extends Rpc.Any>(
	rpc: R,
	handler: AuthQueryHandler<R>,
) =>
	internalQuery(
		confectSchema,
		rpc,
		handler as HandlerFn<R, ConfectQueryCtx>,
		authMiddleware,
	);

export const rpcInternalMutation = <R extends Rpc.Any>(
	rpc: R,
	handler: AuthMutationHandler<R>,
) =>
	internalMutation(
		confectSchema,
		rpc,
		handler as HandlerFn<R, ConfectMutationCtx>,
		authMiddleware,
	);

export const rpcInternalAction = <R extends Rpc.Any>(
	rpc: R,
	handler: AuthActionHandler<R>,
) =>
	internalAction(
		confectSchema,
		rpc,
		handler as HandlerFn<R, ConfectActionCtx>,
		authMiddleware,
	);

export { AuthenticatedUser };
