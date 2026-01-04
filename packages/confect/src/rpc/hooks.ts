import { useAtomValue, useAtom } from "@effect-atom/atom-react";
import { Result } from "@effect-atom/atom";
import type { Atom } from "@effect-atom/atom";

export interface UseQueryResult<Success, Error> {
	data: Success | undefined;
	error: Error | undefined;
	isLoading: boolean;
	isError: boolean;
	isSuccess: boolean;
}

export const useQuery = <Success, E>(
	atom: Atom.Atom<Result.Result<Success, E>>,
): UseQueryResult<Success, E> => {
	const result = useAtomValue(atom);

	return {
		data: Result.isSuccess(result) ? result.value : undefined,
		error: Result.isFailure(result) ? (result.cause as E) : undefined,
		isLoading: Result.isInitial(result) || Result.isWaiting(result),
		isError: Result.isFailure(result),
		isSuccess: Result.isSuccess(result),
	};
};

export interface UseMutationResult<Payload, Success, Error> {
	mutate: (payload: Payload) => void;
	data: Success | undefined;
	error: Error | undefined;
	isLoading: boolean;
	isError: boolean;
	isSuccess: boolean;
}

export const useMutation = <Payload, Success, E>(
	atom: Atom.AtomResultFn<Payload, Success, E>,
): UseMutationResult<Payload, Success, E> => {
	const [result, mutate] = useAtom(atom);

	return {
		mutate,
		data: Result.isSuccess(result) ? result.value : undefined,
		error: Result.isFailure(result) ? (result.cause as E) : undefined,
		isLoading: Result.isWaiting(result),
		isError: Result.isFailure(result),
		isSuccess: Result.isSuccess(result),
	};
};

export const useAction = useMutation;
