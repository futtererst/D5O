param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("delivery", "support")]
  [string]$Checkpoint
)
$ErrorActionPreference = "Stop"
$expected = @{
  delivery = @{ api = "56921"; dump = "71473E1C73B03D5C9ED129BA7DC8EE7D9521575F14E0A4AFB3A1B5D2AA4646A4"; xattrs = "3850E6CD7B8573EE1A4B47A1B4710D36941F71B7E5C1D3B87E3AEBD967A5D6CB"; files = "7A8818874F1D72E6BF15173C01F16F7238CC1920D4D6696613000C5B352B7973" }
  support = @{ api = "56821"; dump = "14288E313DD948E8E37DE20C11FD5F1E9C5A033377F26EA749F121A942FFCD81"; xattrs = "5736E4B3B098EB6AB6AFBEC868C994F1762852C6B798F966EF802A31B64C35FB"; files = "35127B67E9EAD2AD29104952B1BD969A95EB2700AA32436E6D6FC6FCA201C1BA" }
}
$name = "d5o-observe-$Checkpoint-20261010"
$root = Join-Path $env:TEMP $name
$config = Join-Path $root "supabase/config.toml"
if (-not (Test-Path -LiteralPath $config)) { throw "missing_disposable_config" }
$contents = Get-Content -LiteralPath $config -Raw
if (-not $contents.Contains("project_id = `"$name`"") -or -not $contents.Contains("port = $($expected[$Checkpoint].api)") -or $contents.Contains("fcawktdjoxvahhgvkebx")) {
  throw "unexpected_disposable_target"
}
$database = "supabase_db_$name"
$storage = "supabase_storage_$name"
$running = @(docker ps --format "{{.Names}}")
if ($database -notin $running -or $storage -notin $running) { throw "disposable_containers_not_running" }
$archive = Join-Path $root "observation-ready.dump"
$list = Join-Path $root "observation-scoped-restore.list"
$xattrs = Join-Path $root "observation-xattrs.json"
$files = Join-Path $root "observation-file-manifest.json"
$bytes = Join-Path $root "observation-storage-bytes"
foreach ($item in @(@($archive, "dump"), @($xattrs, "xattrs"), @($files, "files"))) {
  if (-not (Test-Path -LiteralPath $item[0]) -or (Get-FileHash -LiteralPath $item[0] -Algorithm SHA256).Hash -ne $expected[$Checkpoint][$item[1]]) {
    throw "checkpoint_hash_mismatch:$($item[1])"
  }
}
if (-not (Test-Path -LiteralPath $list) -or -not (Test-Path -LiteralPath $bytes)) { throw "checkpoint_incomplete" }
$log = Join-Path $root "reset.log"
npx supabase db reset --local --no-seed --workdir $root --yes *> $log
if ($LASTEXITCODE -ne 0) { Get-Content $log -Tail 12; throw "disposable_db_reset_failed" }
docker cp $archive "${database}:/tmp/observation-ready.dump"
if ($LASTEXITCODE -ne 0) { throw "archive_copy_failed" }
docker cp $list "${database}:/tmp/observation-scoped-restore.list"
if ($LASTEXITCODE -ne 0) { throw "restore_list_copy_failed" }
docker exec -e PGPASSWORD=postgres $database pg_restore -U supabase_admin -d postgres --data-only --disable-triggers --no-owner --no-privileges --exit-on-error --use-list=/tmp/observation-scoped-restore.list /tmp/observation-ready.dump *> (Join-Path $root "reset-restore.log")
if ($LASTEXITCODE -ne 0) { Get-Content (Join-Path $root "reset-restore.log") -Tail 12; throw "scoped_restore_failed" }
docker cp (Join-Path $bytes ".") "${storage}:/mnt/stub/stub"
if ($LASTEXITCODE -ne 0) { throw "private_bytes_copy_failed" }
docker cp $xattrs "${storage}:/tmp/d5o-observation-xattrs.json"
docker cp $files "${storage}:/tmp/d5o-observation-file-manifest.json"
docker cp (Join-Path $PSScriptRoot "d5o-observation-storage-xattrs.py") "${storage}:/tmp/d5o-observation-storage-xattrs.py"
if ($LASTEXITCODE -ne 0) { throw "storage_manifest_copy_failed" }
docker exec $storage python3 /tmp/d5o-observation-storage-xattrs.py restore
if ($LASTEXITCODE -ne 0) { throw "private_byte_or_xattr_restore_failed" }
Write-Output "RESET_PASS $Checkpoint $name"