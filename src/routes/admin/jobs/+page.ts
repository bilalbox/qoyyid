import { listAdminJobs } from "#lib/admin-api";
import type { PageLoad } from "./$types";

export const ssr = false;

export const load: PageLoad = async () => {
  const jobs = await listAdminJobs();
  return { jobs };
};
