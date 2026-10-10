// Only handles OS-shared images. No API responses or private analysis are cached.
const SHARE_CACHE="lovetalk-local-share-v1",MAX_BYTES=5_000_000,MAX_AGE_MS=15*60*1000,MAX_PENDING=3;
self.addEventListener("install",event=>event.waitUntil(self.skipWaiting()));
self.addEventListener("activate",event=>event.waitUntil(self.clients.claim()));
async function currentOwner(){
  try{
    const response=await fetch(new URL("/api/auth/session",self.location.origin),{credentials:"include",cache:"no-store"});
    const session=response.ok?await response.json():null;
    return session?.loggedIn&&typeof session.user?.id==="string"?session.user.id:"";
  }catch{return "";}
}
async function prune(cache,owner){
  const now=Date.now(),keys=await cache.keys(),valid=[];
  for(const key of keys){
    const item=await cache.match(key);
    const created=Number(item?.headers.get("X-Shared-At")||0);
    if(!item||!owner||item.headers.get("X-Share-Owner")!==owner||created>now||now-created>MAX_AGE_MS)await cache.delete(key);
    else valid.push({key,created});
  }
  valid.sort((a,b)=>b.created-a.created);
  for(const item of valid.slice(MAX_PENDING))await cache.delete(item.key);
}
self.addEventListener("message",event=>{
  if(event.data?.type==="prune-local-shares")event.waitUntil((async()=>prune(await caches.open(SHARE_CACHE),await currentOwner()))());
});
self.addEventListener("fetch",event=>{
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin||url.pathname!=="/share-target"||event.request.method!=="POST")return;
  event.respondWith((async()=>{
    try{
      const form=await event.request.formData(),image=form.get("image");
      if(!(image instanceof File)||!["image/png","image/jpeg"].includes(image.type)||image.size<16||image.size>MAX_BYTES)
        return Response.redirect(new URL("/crush?share_error=invalid",self.location.origin),303);
      const owner=await currentOwner();
      if(!owner)return Response.redirect(new URL("/crush?share_error=login",self.location.origin),303);
      const cache=await caches.open(SHARE_CACHE);
      await prune(cache,owner);
      const token=crypto.randomUUID();
      await cache.put(new Request(new URL("/.local-shares/"+token,self.location.origin)),new Response(image,{headers:{"Content-Type":image.type,"X-Shared-At":String(Date.now()),"X-Share-Owner":owner}}));
      await prune(cache,owner);
      return Response.redirect(new URL("/crush?share="+encodeURIComponent(token),self.location.origin),303);
    }catch{return Response.redirect(new URL("/crush?share_error=unavailable",self.location.origin),303);}
  })());
});
