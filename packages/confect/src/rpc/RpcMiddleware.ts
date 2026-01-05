import { Effect } from "effect";

export const withKeyAuth = <
	AuthKey extends string,
	Args extends Record<string, unknown> & Record<AuthKey, string>,
	A,
	E,
	R,
	AuthE,
>(
	key: AuthKey,
	validate: (value: string) => boolean,
	onFailure: () => AuthE,
	handler: (args: Omit<Args, AuthKey>) => Effect.Effect<A, E, R>,
): ((args: Args) => Effect.Effect<A, E | AuthE, R>) => {
	return (args: Args) =>
		Effect.gen(function* () {
			const value = args[key];
			if (!validate(value)) {
				return yield* Effect.fail(onFailure());
			}

			const { [key]: _, ...strippedArgs } = args;
			return yield* handler(strippedArgs as Omit<Args, AuthKey>);
		});
};

export const makeKeyAuth = <AuthKey extends string, AuthE>(
	key: AuthKey,
	validate: (value: string) => boolean,
	onFailure: () => AuthE,
) => {
	return <
		Args extends Record<string, unknown> & Record<AuthKey, string>,
		A,
		E,
		R,
	>(
		handler: (args: Omit<Args, AuthKey>) => Effect.Effect<A, E, R>,
	): ((args: Args) => Effect.Effect<A, E | AuthE, R>) =>
		withKeyAuth(key, validate, onFailure, handler);
};
