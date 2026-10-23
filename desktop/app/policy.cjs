'use strict';
const ORIGIN = 'https://coach.lovetalk.love';
const ROUTES = Object.freeze({home:'/workspace',capture:'/capture?method=desktop',reports:'/reports',people:'/archive',chat:'/chat',account:'/account'});
function trusted(url) {
  try { const u=new URL(url); return u.origin===ORIGIN && !u.username && !u.password; } catch { return false; }
}
function external(url) {
  try { const u=new URL(url); return u.protocol==='https:' && !u.username && !u.password && !trusted(url); } catch { return false; }
}
function handoff(url) {
  if (!trusted(url)) throw new Error('INVALID_HANDOFF');
  const u=new URL(url), value=new URLSearchParams(u.hash.slice(1)).get('connect');
  if(u.pathname!=='/capture' || !/^[A-Za-z0-9_-]{43}$/.test(value||'')) throw new Error('INVALID_HANDOFF');
  return value;
}
module.exports={ORIGIN,ROUTES,trusted,external,handoff};
