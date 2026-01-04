import { Atom, Result } from "@effect-atom/atom";
import {
	ConvexClient,
	convexSubscriptionAtom,
	convexMutationAtom,
} from "@packages/confect/client";
import { api } from "../convex/_generated/api";

export const createGuestbookAtoms = (
	runtime: Atom.AtomRuntime<ConvexClient>,
) => {
	const entriesAtom = convexSubscriptionAtom(runtime, {
		query: api.public.guestbook.list,
		args: {},
	});

	const addEntryAtom = convexMutationAtom(runtime, api.public.guestbook.add);

	return { entriesAtom, addEntryAtom };
};

export type GuestbookAtoms = ReturnType<typeof createGuestbookAtoms>;

export { Result };
