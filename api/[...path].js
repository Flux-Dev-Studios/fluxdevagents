const forwardedRequestHeaders = ['accept', 'content-type', 'cookie'];
const forwardedResponseHeaders = ['cache-control', 'content-type', 'retry-after', 'vary'];

export default async function handler(req, res) {
	const backendUrl = process.env.RENDER_API_URL;
	if (!backendUrl) return res.status(500).json({ error: 'RENDER_API_URL is not configured.' });

	let targetUrl;
	try {
		const backendOrigin = new URL(backendUrl);
		targetUrl = new URL(req.url || '/api', backendOrigin);
		if (targetUrl.origin !== backendOrigin.origin) throw new Error('Invalid backend request URL.');
	} catch {
		return res.status(500).json({ error: 'RENDER_API_URL must be a valid backend URL.' });
	}

	const requestHeaders = new Headers();
	for (const name of forwardedRequestHeaders) {
		const value = req.headers[name];
		if (typeof value === 'string') requestHeaders.set(name, value);
		else if (Array.isArray(value)) requestHeaders.set(name, value.join(', '));
	}

	const method = req.method || 'GET';
	const body = ['GET', 'HEAD'].includes(method) || req.body == null
		? undefined
		: typeof req.body === 'string' || Buffer.isBuffer(req.body) ? req.body : JSON.stringify(req.body);

	try {
		const response = await fetch(targetUrl, { method, headers: requestHeaders, body, redirect: 'manual' });
		res.statusCode = response.status;
		for (const name of forwardedResponseHeaders) {
			const value = response.headers.get(name);
			if (value) res.setHeader(name, value);
		}
		const cookies = response.headers.getSetCookie?.() || response.headers.get('set-cookie');
		if (cookies?.length) res.setHeader('set-cookie', cookies);
		res.end(Buffer.from(await response.arrayBuffer()));
	} catch (error) {
		console.error('Render API proxy failed:', error);
		return res.status(502).json({ error: 'The backend is temporarily unavailable.' });
	}
}
