/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

import OpenAI from "openai";
import jwt from '@tsndr/cloudflare-worker-jwt'

export default {
	async fetch(request, env, ctx) {
		const jwtError = JSON.stringify({
			error: {
				"message": "failed_jwt",
				"type": "authentication_error",
				"param": null,
				"code": null
			}
		})
		const jwtFailedResponse = new Response(jwtError, {status: 401})

		const badRequestError = (message)  => { return JSON.stringify({
			"error": {
				"message": message,
				"type": "invalid_request_error",
				"param": null,
				"code": null
			}
		})}

		const authHeader = request.headers.get('Authorization')
		let token;
		if (authHeader.startsWith("Bearer ")){
			token = authHeader.substring(7, authHeader.length);
		} else {
			return jwtFailedResponse
		}
		const isValid = await jwt.verify(token, env.JWT_SECRET)
		if (!isValid) {
			return jwtFailedResponse
		}

		const body = jwt.decode(token)
		const userID = body.payload.sub

		if (request.method !== "POST") {
			return new Response(badRequestError, {status: 405});
		}

		const openai = new OpenAI({
			apiKey: env.OPENAI_API_KEY,
			baseURL: "https://gateway.ai.cloudflare.com/v1/bd4b5fc699778b2bf05b2c3aaa7b2d18/mane-gpt/openai"
		});

		const pathName = new URL(request.url).pathname.split("/")

		if (pathName[1] !== "v1" || pathName[2] !== "chat" || pathName[3] !== "completions" || pathName.length > 4) {
			return new Response(badRequestError, {status: 400});
		}

		try {
			if (!request.body) {
				return new Response(badRequestError, {status: 400});
			}

			const body = await request.json()
			body.user = userID

			if (body.stream !== undefined && body.stream === true) {
				const stream = await openai.chat.completions.create({
					model: body.model,
					messages: [{ role: 'user', content: 'Tell me a story' }],
					stream: true,
				});

				// Using our readable and writable to handle streaming data
				let { readable, writable } = new TransformStream()

				let writer = writable.getWriter()
				const textEncoder = new TextEncoder();

				// loop over the data as it is streamed from OpenAI and write it using our writeable
				for await (const part of stream) {
					console.log(part.choices[0]?.delta?.content || '');
					writer.write(textEncoder.encode(part.choices[0]?.delta?.content || ''));
				}

				writer.close();

				// Send readable back to the browser so it can read the stream content
				return new Response(readable);
			}

			const response = await openai.chat.completions.create(body);
			return new Response(JSON.stringify(response));


		} catch (e) {
			return new Response(e);
		}
	},
};
