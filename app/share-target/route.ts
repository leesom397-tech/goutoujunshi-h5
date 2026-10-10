// The installed PWA's service worker should consume this navigation POST on
// device. If it has not taken control, discard the request without reading or
// storing the image and tell the user to use the ordinary file chooser.
export const runtime="edge";
export async function POST(request:Request){
  return Response.redirect(new URL("/crush?share_error=unavailable",request.url),303);
}
