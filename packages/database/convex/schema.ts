import {
	compileSchema,
	defineSchema,
	defineTable,
} from "@packages/confect/server";
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

export const confectSchema = defineSchema({
	users: defineTable(UserSchema).index("by_email", ["email"]),
	posts: defineTable(PostSchema)
		.index("by_authorId", ["authorId"])
		.index("by_published", ["published"]),
});

export default confectSchema.convexSchemaDefinition;

export { UserSchema, PostSchema };

export const userSchema = compileSchema(UserSchema);
export const postSchema = compileSchema(PostSchema);

export type User = Schema.Schema.Type<typeof UserSchema>;
export type Post = Schema.Schema.Type<typeof PostSchema>;
