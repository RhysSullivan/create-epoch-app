"use client";

import { createContext, useContext } from "react";

type Tenant = {
	serverId: string;
	name: string;
	icon: string | null;
	customDomain: string | null;
	subpath?: string;
};

const TenantContext = createContext<Tenant | null>(null);

export function TenantProvider({
	tenant,
	children,
}: {
	tenant: Tenant | null;
	children: React.ReactNode;
}) {
	return (
		<TenantContext.Provider value={tenant}>{children}</TenantContext.Provider>
	);
}

export function useTenant() {
	return useContext(TenantContext);
}
