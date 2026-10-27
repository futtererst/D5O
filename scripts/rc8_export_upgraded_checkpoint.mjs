// Stream a post-upgrade offline pg_dump into protected AES-256-GCM storage.
// No plaintext database dump is written or printed.
import { createHash, createCipheriv, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, realpathSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { loadProtectedKey } from "./rc6_dpapi_key.mjs";
const [protectedDir,mode] = process.argv.slice(2);
if (!protectedDir || !["schema","data"].includes(mode)) throw Error("provide protected dir and schema|data");
const dir=realpathSync(protectedDir);
const container="d5o-rc7-historical-db";
const inspect=spawnSync("docker",["inspect",container],{encoding:"utf8"});
if(inspect.status!==0) throw Error("isolated upgraded container missing");
const target=JSON.parse(inspect.stdout)[0];
if(target.HostConfig.NetworkMode!=="none" || Object.keys(target.HostConfig.PortBindings??{}).length)
  throw Error("upgraded container not isolated");
const output=join(dir,`rc8-upgraded-${mode}.dump.aesgcm`);
if(existsSync(output)) throw Error("upgraded checkpoint already exists");
const key=loadProtectedKey(dir),nonce=randomBytes(12),cipher=createCipheriv("aes-256-gcm",key,nonce);
const args=["exec",container,"pg_dump","-U","supabase_admin","-d","postgres","--format=custom","--compress=6"];
if(mode==="schema") args.push("--schema-only");
else args.push("--schema=public","--schema=d5o_hosted","--schema=storage","--schema=supabase_migrations");
const child=spawn("docker",args,{stdio:["ignore","pipe","pipe"]});
const closed=new Promise(resolve=>child.once("close",resolve));
let stderr="";child.stderr.on("data",c=>{if(stderr.length<10000)stderr+=c.toString("utf8")});
const sha=createHash("sha256");let plainBytes=0;
const hashPass=new Transform({transform(chunk,encoding,callback){sha.update(chunk);plainBytes+=chunk.length;callback(null,chunk)}});
const file=createWriteStream(output,{flags:"wx",mode:0o600});
file.write(Buffer.concat([Buffer.from("D5ORC6A1"),nonce]));
try{
  await pipeline(child.stdout,hashPass,cipher,file,{end:false});
  file.end(cipher.getAuthTag());
  await new Promise((resolve,reject)=>{file.once("finish",resolve);file.once("error",reject)});
  if(await closed!==0)throw Error("offline pg_dump failed");
  const encryptedHash=createHash("sha256");for await(const chunk of createReadStream(output))encryptedHash.update(chunk);
  console.log(JSON.stringify({mode,encrypted:true,plainBytes,plainSha256:sha.digest("hex"),
    encryptedBytes:statSync(output).size,encryptedSha256:encryptedHash.digest("hex")}));
}catch(error){try{rmSync(output,{force:true})}catch{};throw error}finally{key.fill(0)}
