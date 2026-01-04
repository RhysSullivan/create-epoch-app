import { Result } from "@effect-atom/atom";
import { AtomConvex } from "@packages/confect/client";
import { api } from "@packages/database/convex/_generated/api";

class GuestbookClient extends AtomConvex.Tag<GuestbookClient>()(
	"GuestbookClient",
	{
		url: process.env.NEXT_PUBLIC_CONVEX_URL ?? "",
	},
) {}

export const entriesAtom = GuestbookClient.subscription(
	api.public.guestbook.list,
	{},
);

export const addEntryAtom = GuestbookClient.mutation(api.public.guestbook.add);

export { Result, GuestbookClient };
