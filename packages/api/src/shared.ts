import { Schema } from "effect";

export const AuthPayload = Schema.Struct({
	privateAccessKey: Schema.String,
});

export type AuthPayload = typeof AuthPayload.Type;
