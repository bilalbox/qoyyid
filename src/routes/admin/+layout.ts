import { redirect } from "@sveltejs/kit";
import type { LayoutLoad } from "./$types";

export const ssr = false;

export const load: LayoutLoad = async ({ parent }) => {
  const { me } = await parent();
  if (!me?.is_admin) redirect(302, "/");
  return {};
};
