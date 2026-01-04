"use client";

import { convexClient } from "@convex-dev/better-auth/client/plugins";
import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
import { anonymousClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { ConvexQueryCacheProvider } from "convex-helpers/react/cache/provider";
import { createContext, type ReactNode, useContext, useMemo } from "react";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!, {
	expectAuth: false,
	unsavedChangesWarning: false,
});

const authClient = createAuthClient({
	plugins: [anonymousClient(), convexClient()],
});

type AuthClient = typeof authClient;

const AuthClientContext = createContext<AuthClient | null>(null);

function AuthClientProvider({ children }: { children: ReactNode }) {
	return (
		<AuthClientContext.Provider value={authClient}>
			<ConvexBetterAuthProvider client={convex} authClient={authClient}>
				{children}
			</ConvexBetterAuthProvider>
		</AuthClientContext.Provider>
	);
}

export function useAuthClient() {
	const authClient = useContext(AuthClientContext);
	if (!authClient) {
		throw new Error("useAuthClient must be used within an AuthClientProvider");
	}
	return authClient;
}

export const useSession = (
	props: { allowAnonymous?: boolean } = { allowAnonymous: true },
) => {
	const authClient = useAuthClient();
	const session = authClient.useSession();
	const isAnonymousUser = session?.data?.user?.isAnonymous ?? false;
	const shouldHideData = !props.allowAnonymous && isAnonymousUser;

	return useMemo(() => {
		if (shouldHideData) {
			return {
				...session,
				data: null,
			};
		}
		return session;
	}, [session, shouldHideData]);
};

export const useNonAnonymousSession = () => {
	return useSession({ allowAnonymous: false });
};

export function ConvexClientProvider({ children }: { children: ReactNode }) {
	return (
		<ConvexProvider client={convex}>
			<ConvexQueryCacheProvider>
				<AuthClientProvider>{children}</AuthClientProvider>
			</ConvexQueryCacheProvider>
		</ConvexProvider>
	);
}
