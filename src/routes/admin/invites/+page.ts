import { listInvites } from "#lib/admin-api";
import type { PageLoad } from "./$types";

export const ssr = false;

export const load: PageLoad = async () => {
  const invites = await listInvites();
  return { invites };
};
