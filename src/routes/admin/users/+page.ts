import { listUsers } from "$lib/admin-api";
import type { PageLoad } from "./$types";

export const ssr = false;

export const load: PageLoad = async () => {
  const users = await listUsers();
  return { users };
};
