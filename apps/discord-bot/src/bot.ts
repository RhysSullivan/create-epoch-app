import { Console, Effect, Layer } from "effect";
import { Discord } from "./core/discord-service";

export const BotLayers = Layer.empty;

export const program = Effect.gen(function* () {
	const discord = yield* Discord;

	yield* discord.client.login();

	const guilds = yield* discord.getGuilds();
	yield* Console.log(`Bot is in ${guilds.length} guilds`);

	return yield* Effect.never;
});
