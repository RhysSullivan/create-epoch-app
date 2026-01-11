import {
	ActionRow,
	Container,
	ModalButton,
	Result,
	Section,
	Separator,
	TextDisplay,
	useAtom,
	useAtomValue,
} from "@packages/reacord";
import { useState } from "react";
import { guestbookClient } from "../rpc/guestbook";

type GuestbookEntry = {
	_id: string;
	_creationTime: number;
	name: string;
	message: string;
};

export function GuestbookCommand() {
	const entriesResult = useAtomValue(guestbookClient.list.subscription({}));
	const [, triggerAdd] = useAtom(guestbookClient.add.mutate, {
		mode: "promiseExit",
	});
	const [isAdding, setIsAdding] = useState(false);

	if (Result.isInitial(entriesResult)) {
		return (
			<Container>
				<TextDisplay>Loading guestbook...</TextDisplay>
			</Container>
		);
	}

	if (Result.isFailure(entriesResult)) {
		return (
			<Container>
				<TextDisplay>Failed to load guestbook entries.</TextDisplay>
			</Container>
		);
	}

	const entries = entriesResult.value as ReadonlyArray<GuestbookEntry>;

	return (
		<Container>
			<Section>
				<TextDisplay>**Guestbook** ({entries.length} entries)</TextDisplay>
			</Section>

			<Separator />

			{entries.length === 0 ? (
				<Section>
					<TextDisplay>No entries yet. Be the first to sign!</TextDisplay>
				</Section>
			) : (
				entries.slice(0, 5).map((entry) => (
					<Section key={entry._id}>
						<TextDisplay>
							**{entry.name}**: {entry.message}
						</TextDisplay>
					</Section>
				))
			)}

			{entries.length > 5 && (
				<Section>
					<TextDisplay>...and {entries.length - 5} more</TextDisplay>
				</Section>
			)}

			<Separator />

			<ActionRow>
				<ModalButton
					style="primary"
					label="Sign Guestbook"
					disabled={isAdding}
					modalTitle="Sign the Guestbook"
					fields={[
						{
							type: "textInput",
							id: "name",
							label: "Your Name",
							placeholder: "Enter your name",
							required: true,
							maxLength: 100,
						},
						{
							type: "textInput",
							id: "message",
							label: "Your Message",
							placeholder: "Leave a message",
							style: "paragraph",
							required: true,
							maxLength: 500,
						},
					]}
					onSubmit={async (values, interaction) => {
						const name = values.getTextInput("name");
						const message = values.getTextInput("message");

						if (!name || !message) {
							await interaction.reply({
								content: "Please fill in all fields.",
								flags: ["Ephemeral"],
							});
							return;
						}

						setIsAdding(true);
						try {
							const result = await triggerAdd({ name, message });
							await interaction.reply({
								content: `Thanks for signing, ${name}!`,
								flags: ["Ephemeral"],
							});
						} catch {
							await interaction.reply({
								content: "Failed to add entry. Please try again.",
								flags: ["Ephemeral"],
							});
						} finally {
							setIsAdding(false);
						}
					}}
				/>
			</ActionRow>
		</Container>
	);
}
