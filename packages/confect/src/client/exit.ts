import { Exit, Schema } from "effect";

export const isSuccess = <A, E>(
	exit: Schema.ExitEncoded<A, E, unknown>,
): exit is { readonly _tag: "Success"; readonly value: A } =>
	exit._tag === "Success";

export const isFailure = <A, E>(
	exit: Schema.ExitEncoded<A, E, unknown>,
): exit is { readonly _tag: "Failure"; readonly cause: Schema.CauseEncoded<E, unknown> } =>
	exit._tag === "Failure";

export const getValueOrThrow = <A, E>(
	exit: Schema.ExitEncoded<A, E, unknown>,
): A => {
	if (isSuccess(exit)) {
		return exit.value;
	}
	throw new Error(`Exit failed: ${JSON.stringify(exit.cause)}`);
};

export const getValueOrNull = <A, E>(
	exit: Schema.ExitEncoded<A, E, unknown>,
): A | null => {
	if (isSuccess(exit)) {
		return exit.value;
	}
	return null;
};

export const getFailureOrNull = <A, E>(
	exit: Schema.ExitEncoded<A, E, unknown>,
): E | null => {
	if (isFailure(exit) && exit.cause._tag === "Fail") {
		return exit.cause.error;
	}
	return null;
};

export const match = <A, E, R1, R2>(
	exit: Schema.ExitEncoded<A, E, unknown>,
	options: {
		readonly onSuccess: (value: A) => R1;
		readonly onFailure: (error: E) => R2;
	},
): R1 | R2 => {
	if (isSuccess(exit)) {
		return options.onSuccess(exit.value);
	}
	if (exit.cause._tag === "Fail") {
		return options.onFailure(exit.cause.error);
	}
	throw new Error(`Unexpected cause: ${JSON.stringify(exit.cause)}`);
};

export { Exit };
