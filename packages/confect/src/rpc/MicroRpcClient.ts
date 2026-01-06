import type { FunctionReference, FunctionReturnType } from "convex/server";
import { ConvexHttpClient, ConvexClient as ConvexBrowserClient } from "convex/browser";
import type { MicroExit, AnyMicroRpcModule, MicroRpcEndpoint } from "./MicroRpcBuilder";
import type { PropertyValidators } from "convex/values";

export type { MicroExit } from "./MicroRpcBuilder";

export class MicroRpcError<E> extends Error {
	readonly _tag = "MicroRpcError";
	constructor(readonly error: E) {
		super(typeof error === "string" ? error : JSON.stringify(error));
		this.name = "MicroRpcError";
	}
}

export class MicroRpcDefect extends Error {
	readonly _tag = "MicroRpcDefect";
	constructor(readonly defect: unknown) {
		super(typeof defect === "string" ? defect : JSON.stringify(defect));
		this.name = "MicroRpcDefect";
	}
}

export const decodeMicroExit = <A, E>(exit: MicroExit<A, E>): A => {
	if (exit._tag === "Success") {
		return exit.value;
	}
	if (exit._tag === "Failure") {
		throw new MicroRpcError(exit.error);
	}
	throw new MicroRpcDefect(exit.defect);
};

export const decodeMicroExitSafe = <A, E>(
	exit: MicroExit<A, E>,
): { success: true; value: A } | { success: false; error: MicroRpcError<E> | MicroRpcDefect } => {
	if (exit._tag === "Success") {
		return { success: true, value: exit.value };
	}
	if (exit._tag === "Failure") {
		return { success: false, error: new MicroRpcError(exit.error) };
	}
	return { success: false, error: new MicroRpcDefect(exit.defect) };
};

export interface MicroRpcClientConfig {
	readonly url: string;
	readonly useHttpClient?: boolean;
}

type ExtractEndpointSuccess<E> = E extends MicroRpcEndpoint<
	string,
	PropertyValidators,
	infer Success,
	unknown,
	unknown
>
	? Success
	: never;

type ExtractEndpointError<E> = E extends MicroRpcEndpoint<
	string,
	PropertyValidators,
	unknown,
	infer Error,
	unknown
>
	? Error
	: never;

type ExtractEndpointArgs<E> = E extends MicroRpcEndpoint<
	string,
	infer Args,
	unknown,
	unknown,
	unknown
>
	? Args
	: never;

type InferArgsFromValidators<V extends PropertyValidators> = {
	[K in keyof V]: V[K] extends { parse: (value: unknown) => infer T } ? T : unknown;
};

export interface MicroRpcModuleClient<M extends AnyMicroRpcModule> {
	readonly query: <K extends keyof M["_def"]["endpoints"] & string>(
		endpoint: K,
		args: InferArgsFromValidators<ExtractEndpointArgs<M["_def"]["endpoints"][K]>>,
	) => Promise<ExtractEndpointSuccess<M["_def"]["endpoints"][K]>>;

	readonly mutation: <K extends keyof M["_def"]["endpoints"] & string>(
		endpoint: K,
		args: InferArgsFromValidators<ExtractEndpointArgs<M["_def"]["endpoints"][K]>>,
	) => Promise<ExtractEndpointSuccess<M["_def"]["endpoints"][K]>>;

	readonly querySafe: <K extends keyof M["_def"]["endpoints"] & string>(
		endpoint: K,
		args: InferArgsFromValidators<ExtractEndpointArgs<M["_def"]["endpoints"][K]>>,
	) => Promise<
		| { success: true; value: ExtractEndpointSuccess<M["_def"]["endpoints"][K]> }
		| {
				success: false;
				error:
					| MicroRpcError<ExtractEndpointError<M["_def"]["endpoints"][K]>>
					| MicroRpcDefect;
		  }
	>;

	readonly mutationSafe: <K extends keyof M["_def"]["endpoints"] & string>(
		endpoint: K,
		args: InferArgsFromValidators<ExtractEndpointArgs<M["_def"]["endpoints"][K]>>,
	) => Promise<
		| { success: true; value: ExtractEndpointSuccess<M["_def"]["endpoints"][K]> }
		| {
				success: false;
				error:
					| MicroRpcError<ExtractEndpointError<M["_def"]["endpoints"][K]>>
					| MicroRpcDefect;
		  }
	>;
}

export const createMicroRpcClient = <M extends AnyMicroRpcModule>(
	_module: M,
	api: Record<string, FunctionReference<"query" | "mutation">>,
	config: MicroRpcClientConfig,
): MicroRpcModuleClient<M> => {
	const client = config.useHttpClient
		? new ConvexHttpClient(config.url)
		: new ConvexBrowserClient(config.url);

	const callQuery = async <K extends keyof M["_def"]["endpoints"] & string>(
		endpoint: K,
		args: Record<string, unknown>,
	): Promise<MicroExit<unknown, unknown>> => {
		const fn = api[endpoint] as FunctionReference<"query">;
		return await client.query(fn, args);
	};

	const callMutation = async <K extends keyof M["_def"]["endpoints"] & string>(
		endpoint: K,
		args: Record<string, unknown>,
	): Promise<MicroExit<unknown, unknown>> => {
		const fn = api[endpoint] as FunctionReference<"mutation">;
		return await client.mutation(fn, args);
	};

	return {
		query: async (endpoint, args) => {
			const exit = await callQuery(endpoint, args as Record<string, unknown>);
			return decodeMicroExit(exit) as ExtractEndpointSuccess<M["_def"]["endpoints"][typeof endpoint]>;
		},

		mutation: async (endpoint, args) => {
			const exit = await callMutation(endpoint, args as Record<string, unknown>);
			return decodeMicroExit(exit) as ExtractEndpointSuccess<M["_def"]["endpoints"][typeof endpoint]>;
		},

		querySafe: async (endpoint, args) => {
			const exit = await callQuery(endpoint, args as Record<string, unknown>);
			return decodeMicroExitSafe(exit) as
				| { success: true; value: ExtractEndpointSuccess<M["_def"]["endpoints"][typeof endpoint]> }
				| {
						success: false;
						error:
							| MicroRpcError<ExtractEndpointError<M["_def"]["endpoints"][typeof endpoint]>>
							| MicroRpcDefect;
				  };
		},

		mutationSafe: async (endpoint, args) => {
			const exit = await callMutation(endpoint, args as Record<string, unknown>);
			return decodeMicroExitSafe(exit) as
				| { success: true; value: ExtractEndpointSuccess<M["_def"]["endpoints"][typeof endpoint]> }
				| {
						success: false;
						error:
							| MicroRpcError<ExtractEndpointError<M["_def"]["endpoints"][typeof endpoint]>>
							| MicroRpcDefect;
				  };
		},
	};
};

export const useMicroExit = <A, E>(exit: MicroExit<A, E> | undefined): A | undefined => {
	if (!exit) return undefined;
	if (exit._tag === "Success") return exit.value;
	return undefined;
};

export const useMicroExitWithError = <A, E>(
	exit: MicroExit<A, E> | undefined,
): { data: A | undefined; error: E | undefined; defect: unknown | undefined } => {
	if (!exit) return { data: undefined, error: undefined, defect: undefined };
	if (exit._tag === "Success") return { data: exit.value, error: undefined, defect: undefined };
	if (exit._tag === "Failure") return { data: undefined, error: exit.error, defect: undefined };
	return { data: undefined, error: undefined, defect: exit.defect };
};
