import { Atom } from "@effect-atom/atom";
import {
	ConvexClient,
	convexSubscriptionAtom,
	convexQueryAtom,
} from "@packages/confect/client";
import type { Id } from "../convex/_generated/dataModel";
import { api } from "../convex/_generated/api";

export const usersListAtom = (runtime: Atom.AtomRuntime<ConvexClient>) =>
	convexSubscriptionAtom(runtime, {
		query: api.public.users.list,
		args: {},
	});

export const userByEmailAtom = (
	runtime: Atom.AtomRuntime<ConvexClient>,
	email: string,
) =>
	convexQueryAtom(runtime, {
		query: api.public.users.getByEmail,
		args: { email },
	});

export const publishedPostsAtom = (runtime: Atom.AtomRuntime<ConvexClient>) =>
	convexSubscriptionAtom(runtime, {
		query: api.public.posts.listPublished,
		args: {},
	});

export const postByIdAtom = (
	runtime: Atom.AtomRuntime<ConvexClient>,
	id: Id<"posts">,
) =>
	convexQueryAtom(runtime, {
		query: api.public.posts.getById,
		args: { id },
	});
