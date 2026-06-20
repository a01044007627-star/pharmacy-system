import { promises as fs } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..")
async function walk(dir,exts){const out=[];for(const entry of await fs.readdir(dir,{withFileTypes:true})){const p=path.join(dir,entry.name);if(entry.isDirectory())out.push(...await walk(p,exts));else if(exts.some(e=>entry.name.endsWith(e)))out.push(p)}return out}
const sourceFiles=await walk(path.join(root,"src"),[".ts",".tsx"])
const sqlFiles=[...(await walk(path.join(root,"supabase","consolidated"),[".sql"])),...(await walk(path.join(root,"supabase","migrations"),[".sql"]))]
const source=await Promise.all(sourceFiles.map(async f=>[f,await fs.readFile(f,"utf8")]))
const sqlText=(await Promise.all(sqlFiles.map(f=>fs.readFile(f,"utf8")))).join("\n")
const tableRefs=new Set(),rpcRefs=new Set(),apiRefs=new Set()
for(const[,text]of source){for(const m of text.matchAll(/\.from\(\s*["'`]([a-zA-Z0-9_]+)["'`]\s*\)/g))tableRefs.add(m[1]);for(const m of text.matchAll(/\.rpc\(\s*["'`]([a-zA-Z0-9_]+)["'`]/g))rpcRefs.add(m[1]);for(const m of text.matchAll(/["'`]\/api\/([^"'`\s?#]*)/g))apiRefs.add(`/api/${m[1]}`)}
const createdTables=new Set([...sqlText.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?([a-zA-Z0-9_]+)/gi)].map(m=>m[1]))
const createdFunctions=new Set([...sqlText.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?([a-zA-Z0-9_]+)/gi)].map(m=>m[1]))
const missingTables=[...tableRefs].filter(n=>!createdTables.has(n)&&!["objects","buckets"].includes(n)).sort()
const missingFunctions=[...rpcRefs].filter(n=>!createdFunctions.has(n)).sort()
const routeFiles=sourceFiles.filter(f=>/\/src\/app\/api\/.+\/route\.ts$/.test(f.replaceAll("\\","/")))
const routes=routeFiles.map(f=>f.replaceAll("\\","/").split("/src/app")[1].replace(/\/route\.ts$/,"").split("/").filter(Boolean))
function parts(ref){return ref.replace(/\$\{[^}]+\}/g,":dynamic").replace(/\/$/,"").split("/").filter(Boolean)}
function matches(ref){const p=parts(ref);return routes.some(r=>r.length===p.length&&r.every((s,i)=>/^\[.+\]$/.test(s)||s===p[i]||p[i]===":dynamic"))}
const missingApiRoutes=[...apiRefs].filter(ref=>!ref.includes("${")&&!matches(ref)).sort()
const runtimeText=source.map(([f,t])=>`${f}\n${t}`).join("\n")
const hardcodedDeveloperEmail=/mostafa0falcon@gmail\.com/i.test(runtimeText)
const result={sourceFiles:sourceFiles.length,sqlFiles:sqlFiles.length,referencedTables:tableRefs.size,createdTables:createdTables.size,referencedRpcFunctions:rpcRefs.size,createdFunctions:createdFunctions.size,apiRoutes:routes.length,apiReferences:apiRefs.size,missingTables,missingFunctions,missingApiRoutes,hardcodedDeveloperEmail}
console.log(JSON.stringify(result,null,2))
if(missingTables.length||missingFunctions.length||missingApiRoutes.length||hardcodedDeveloperEmail)process.exitCode=1
