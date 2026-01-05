import { useAtom, useAtomValue } from "@effect-atom/atom-react";
import { GuestbookRpcs } from "@packages/api/guestbook";
import { RpcClient } from "@packages/confect/rpc";
import { api } from "@packages/database/convex/_generated/api";

const CONVEX_URL =
	typeof process !== "undefined"
		? (process.env.NEXT_PUBLIC_CONVEX_URL ?? "")
		: "";
const PRIVATE_ACCESS_KEY =
	typeof process !== "undefined"
		? (process.env.PRIVATE_ACCESS_KEY ?? "test-key")
		: "test-key";

const guestbookClient = RpcClient.makeWithShared(
	GuestbookRpcs,
	api.rpc.guestbook,
	{ url: CONVEX_URL },
	() => ({ privateAccessKey: PRIVATE_ACCESS_KEY }),
);

export const useGuestbookList = () =>
	useAtomValue(guestbookClient.query("list", {}));

export const useGuestbookSubscription = () =>
	useAtomValue(guestbookClient.subscription("list", {}));

export const useGuestbookAdd = () => useAtom(guestbookClient.mutation("add"));

export { guestbookClient };
