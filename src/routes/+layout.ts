import type { LayoutLoad } from "./$types";

export const ssr = false;

interface Me {
	id: string;
	email: string;
	is_admin: boolean;
	quota_pages_limit: number;
	quota_pages_used: number;
}

export const load: LayoutLoad = async ({ url }) => {
	if (url.pathname === "/login") return { me: null };
	const res = await fetch("/me");
	if (res.status === 401) {
		if (typeof window !== "undefined") window.location.href = "/login";
		return { me: null };
	}
	const me = (await res.json()) as Me;
	return { me };
};
