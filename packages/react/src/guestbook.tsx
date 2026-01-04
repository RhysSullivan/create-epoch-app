import { Atom, Result } from "@effect-atom/atom";
import {
	ConvexClient,
	convexSubscriptionAtom,
	convexMutationAtom,
} from "@packages/confect/client";
import { api } from "@packages/database/convex/_generated/api";

export interface GuestbookEntry {
	_id: string;
	_creationTime: number;
	name: string;
	message: string;
}

export const createGuestbookAtoms = (
	runtime: Atom.AtomRuntime<ConvexClient>,
) => {
	const entriesAtom = convexSubscriptionAtom<
		typeof api.public.guestbook.list,
		Array<GuestbookEntry>
	>(runtime, {
		query: api.public.guestbook.list,
		args: {},
	});

	const addEntryAtom = convexMutationAtom(runtime, api.public.guestbook.add);

	return { entriesAtom, addEntryAtom };
};

export type GuestbookAtoms = ReturnType<typeof createGuestbookAtoms>;

export { Result };
