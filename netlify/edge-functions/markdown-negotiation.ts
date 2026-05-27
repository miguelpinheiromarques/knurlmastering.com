import type { Context } from "https://edge.netlify.com";

export default async function handler(request: Request, context: Context) {
  // Check if the incoming request specifically wants markdown
  const acceptHeader = request.headers.get("accept") || "";
  
  if (acceptHeader.includes("text/markdown")) {
	// Fetch the raw llms.txt asset from your site instead of the HTML page
	const url = new URL(request.url);
	const llmsUrl = `${url.origin}/llms.txt`;
	
	const response = await fetch(llmsUrl);
	
	// Return the text stream with the exact headers mandated by the AI specification
	return new Response(response.body, {
	  status: 200,
	  headers: {
		"Content-Type": "text/markdown; charset=utf-8",
		"Cache-Control": "public, max-age=0, must-revalidate",
		"Vary": "Accept",
		"X-Markdown-Tokens": "true",
		"Access-Control-Allow-Origin": "*"
	  }
	});
  }

  // Otherwise, do nothing and pass the request through to normal HTML templates/redirects
  return context.next();
}