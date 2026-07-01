export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export function jobKeys(jobId: string) {
  const base = `jobs/${jobId}`;
  return {
    meta: `${base}/meta.json`,
    mistralResponse: `${base}/mistral_response.json`,
    document: `${base}/document.json`,
    docx: `${base}/output.docx`,
  };
}

export function uploadPdfKey(sha256: string): string {
  return `uploads/${sha256}.pdf`;
}
