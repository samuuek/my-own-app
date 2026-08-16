const VERSION=1
export function saveWorkspace<T>(id:string,state:T){localStorage.setItem(`siyu:${id}`,JSON.stringify({version:VERSION,state}))}
export function loadWorkspace<T>(id:string,fallback:T):T{try{const raw=localStorage.getItem(`siyu:${id}`);if(!raw)return fallback;const parsed=JSON.parse(raw);return parsed.version===VERSION?parsed.state:fallback}catch{return fallback}}
