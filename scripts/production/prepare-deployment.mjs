#!/usr/bin/env node
// Creates an immutable source artifact for an authorized Vercel deployment.
// This script never deploys or writes hosted configuration.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const out = process.env.D5O_ARTIFACT_DIR;
if (!out || !resolve(out).startsWith(resolve(process.env.TEMP || process.env.TMP || '/tmp'))) {
  throw new Error('D5O_ARTIFACT_DIR must be inside the temporary directory');
}
const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
if (git('status', '--porcelain')) throw new Error('Release worktree must be clean');
const sha = git('rev-parse', 'HEAD');
const appTree = git('rev-parse', 'HEAD:app');
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const manifestPath = resolve(root, 'docs/release/evidence/D5O_RC5_COMPLETE_236_MIGRATION_MANIFEST.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')).migrations;
if (manifest.length !== 236) throw new Error('Migration count changed');
for (const item of manifest) {
  if (sha256(resolve(root, 'supabase/migrations', item.filename)) !== item.sha256) throw new Error(`Migration checksum mismatch at order ${item.order}`);
}
const bridge = ['rc8_bridge_pre_215.sql', 'rc8_bridge_post_215.sql'];
const bridgeSha256 = Object.fromEntries(bridge.map((name) => [name, sha256(resolve(root, 'scripts', name))]));
if (bridgeSha256[bridge[0]] !== '0f076c496f756b8f56965b104cddd8c77c558344c89ca84cbf85946dfa924af5' ||
    bridgeSha256[bridge[1]] !== 'b15dcd56a30fc4b46e81ea792fbfd51e19213630b698bd5734334f0cccbdf5d8') {
  throw new Error('Bridge checksum changed');
}
if (!existsSync(resolve(root, '.next/BUILD_ID'))) throw new Error('Clean production build is required');
mkdirSync(out, { recursive: true });
const archive = resolve(out, `d5o-${sha}.tar`);
execFileSync('git', ['-C', root, 'archive', '--format=tar', '--output', archive, 'HEAD']);
const result = {
  sourceCommit: sha,
  applicationTree: appTree,
  migrationCount: manifest.length,
  migrationManifestSha256: sha256(manifestPath),
  bridgeSha256,
  archiveSha256: sha256(archive),
  targetVercelProject: 'prj_HF8KhxUFvONQlpMr53FdhEgmIpFG',
  deploymentPerformed: false,
  nextAuthorizedStep: 'Extract archive into a clean directory, link only to the verified Vercel project, validate scoped environment bindings, then run vercel deploy --prod only after explicit cutover authorization.'
};
writeFileSync(resolve(out, 'artifact.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
