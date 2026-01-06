import { defineSchema, defineTable } from "@packages/confect/server";
import { Schema } from "effect";

const UserSchema = Schema.Struct({
	name: Schema.String,
	email: Schema.String,
});

const PostSchema = Schema.Struct({
	title: Schema.String,
	content: Schema.String,
	authorId: Schema.String,
	published: Schema.Boolean,
});

const GuestbookEntrySchema = Schema.Struct({
	name: Schema.String,
	message: Schema.String,
});

export const confectSchema = defineSchema({
	users: defineTable(UserSchema).index("by_email", ["email"]),
	posts: defineTable(PostSchema)
		.index("by_authorId", ["authorId"])
		.index("by_published", ["published"]),
	guestbook: defineTable(GuestbookEntrySchema),
});

export default confectSchema.convexSchemaDefinition;
