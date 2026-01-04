import * as Metric from "effect/Metric";
import * as MetricBoundaries from "effect/MetricBoundaries";

export const commandExecuted = (commandName: string) =>
	Metric.counter("discord.commands.executed", {
		description: "Number of Discord commands executed",
	}).pipe(Metric.tagged("command", commandName));

export const commandDuration = Metric.histogram(
	"discord.commands.duration_ms",
	MetricBoundaries.linear({ start: 10, width: 50, count: 10 }),
	"Duration of Discord command execution in milliseconds",
);

export const discordApiCalls = Metric.counter("discord.api.calls", {
	description: "Number of Discord API calls made",
});

export const discordApiErrors = Metric.counter("discord.api.errors", {
	description: "Number of Discord API errors",
});

export const eventsProcessed = Metric.counter("discord.events.processed", {
	description: "Number of Discord events processed",
});
