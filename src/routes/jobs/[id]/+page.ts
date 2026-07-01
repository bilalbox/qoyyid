import { getJob } from "$lib/api";
import type { PageLoad } from "./$types";

export const ssr = false;

export const load: PageLoad = async ({ params }) => {
  const job = await getJob(params.id);
  return { job };
};
