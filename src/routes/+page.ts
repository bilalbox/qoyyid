import { listJobs } from "#lib/api";
import type { PageLoad } from "./$types";

export const ssr = false;

export const load: PageLoad = async () => {
  const jobs = await listJobs();
  return { jobs };
};
