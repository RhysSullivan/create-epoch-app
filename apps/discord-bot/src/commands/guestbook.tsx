import { AtomConvex, ExitResult } from "@packages/confect/client";
import { api } from "@packages/database/convex/_generated/api";
import {
	ActionRow,
	Button,
	Container,
	Result,
	TextDisplay,
	useAtomSet,
	useAtomValue,
} from "@packages/reacord";
import { Cause } from "effect";
import { useState } from "react";

class GuestbookClient extends AtomConvex.Tag<GuestbookClient>()(
	"GuestbookClient",
	{
		url: process.env.CONVEPUBLIC_X_URL ?? "",
	},
) {}

const entriesAtom = GuestbookClient.subscription(api.public.guestbook.list, {});
const addEntryAtom = GuestbookClient.mutation(api.public.guestbook.add);

export function GuestbookCommand() {
	const result = useAtomValue(entriesAtom);
	const addEntry = useAtomSet(addEntryAtom);
	const [isAdding, setIsAdding] = useState(false);

	const handleAdd = async () => {
		setIsAdding(true);
		try {
			await addEntry({
				name: "Discord User",
				message: `Signed from Discord at ${new Date().toLocaleString()}`,
			});
		} finally {
			setIsAdding(false);
		}
	};

	if (Result.isInitial(result)) {
		return (
			<Container>
				<TextDisplay>Loading guestbook...</TextDisplay>
			</Container>
		);
	}

	if (Result.isFailure(result)) {
		return (
			<Container>
				<TextDisplay>Error: {Cause.pretty(result.cause)}</TextDisplay>
			</Container>
		);
	}

	const entries = result.value;

	return (
		<Container>
			<TextDisplay>
				**Guestbook** ({entries.length} messages)
				{"\n\n"}
				{entries.length === 0
					? "_No messages yet. Be the first to sign!_"
					: entries
							.slice(0, 5)
							.map((e) => `**${e.name}**: ${e.message}`)
							.join("\n")}
				{entries.length > 5 && `\n\n_...and ${entries.length - 5} more_`}
			</TextDisplay>
			<ActionRow>
				<Button
					style="primary"
					disabled={isAdding}
					label={isAdding ? "Signing..." : "Sign Guestbook"}
					onClick={handleAdd}
				/>
			</ActionRow>
		</Container>
	);
}
