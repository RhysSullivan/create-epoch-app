import { useAtomValue, useAtom } from "@effect-atom/atom-react";
import { GuestbookRpcs } from "@packages/api/guestbook";
import { RpcClient } from "@packages/confect/rpc";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";
const PRIVATE_ACCESS_KEY = process.env.PRIVATE_ACCESS_KEY ?? "";

const guestbookClient = RpcClient.makeWithShared(
	GuestbookRpcs,
	{
		list: { _type: "query" } as never,
		add: { _type: "mutation" } as never,
	},
	{ url: CONVEX_URL },
	() => ({ privateAccessKey: PRIVATE_ACCESS_KEY }),
);

export const useGuestbookList = () =>
	useAtomValue(guestbookClient.query("list", {}));

export const useGuestbookAdd = () => useAtom(guestbookClient.mutation("add"));

export { guestbookClient };
