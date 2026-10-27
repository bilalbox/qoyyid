export { sha256Hex } from "./hash";

export async function getBytes(
	bucket: R2Bucket,
	key: string,
): Promise<Uint8Array | null> {
	const obj = await bucket.get(key);
	if (!obj) return null;
	return new Uint8Array(await obj.arrayBuffer());
}

export async function putBytes(
	bucket: R2Bucket,
	key: string,
	body: Uint8Array | ArrayBuffer,
	contentType?: string,
): Promise<void> {
	await bucket.put(
		key,
		body,
		contentType ? { httpMetadata: { contentType } } : undefined,
	);
}

export async function putJson(
	bucket: R2Bucket,
	key: string,
	data: unknown,
): Promise<void> {
	const body = JSON.stringify(data, null, 0);
	await bucket.put(key, body, {
		httpMetadata: { contentType: "application/json; charset=utf-8" },
	});
}

export async function getJson<T>(
	bucket: R2Bucket,
	key: string,
): Promise<T | null> {
	const obj = await bucket.get(key);
	if (!obj) return null;
	return (await obj.json()) as T;
}

export async function exists(bucket: R2Bucket, key: string): Promise<boolean> {
	return (await bucket.head(key)) !== null;
}
