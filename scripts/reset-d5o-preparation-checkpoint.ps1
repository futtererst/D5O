$ErrorActionPreference = "Stop"
$name = "d5o-preparation-solution-20261011"
$root = Join-Path $env:TEMP $name
$config = Join-Path $root "supabase/config.toml"
$archive = Join-Path $root "preparation-review-ready.dump"
$list = Join-Path $root "preparation-scoped-restore.list"
$expectedHash = "82A0BB7271AC9EA367960EC8E78798A70691D9F6E2420AE79C135D3E06523D72"
if (-not (Test-Path -LiteralPath $config) -or -not (Test-Path -LiteralPath $archive) -or -not (Test-Path -LiteralPath $list)) { throw "preparation_checkpoint_missing" }
$contents = Get-Content -LiteralPath $config -Raw
if (-not $contents.Contains("project_id = `"$name`"") -or -not $contents.Contains("port = 56621") -or $contents.Contains("fcawktdjoxvahhgvkebx")) { throw "unexpected_disposable_target" }
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $expectedHash) { throw "preparation_checkpoint_hash_mismatch" }
$database = "supabase_db_$name"
if ($database -notin @(docker ps --format "{{.Names}}")) { throw "disposable_database_not_running" }
npx supabase db reset --local --no-seed --workdir $root --yes *> (Join-Path $root "preparation-reset.log")
if ($LASTEXITCODE -ne 0) { throw "disposable_db_reset_failed" }
docker cp $archive "${database}:/tmp/preparation-review-ready.dump"
if ($LASTEXITCODE -ne 0) { throw "checkpoint_copy_failed" }
docker cp $list "${database}:/tmp/preparation-scoped-restore.list"
if ($LASTEXITCODE -ne 0) { throw "restore_list_copy_failed" }
docker exec -e PGPASSWORD=postgres $database pg_restore -U supabase_admin -d postgres --data-only --disable-triggers --no-owner --no-privileges --exit-on-error --use-list=/tmp/preparation-scoped-restore.list /tmp/preparation-review-ready.dump *> (Join-Path $root "preparation-restore.log")
if ($LASTEXITCODE -ne 0) { throw "scoped_restore_failed" }
$position = docker exec -e PGPASSWORD=postgres $database psql -U supabase_admin -d postgres -Atc "select work_id::text || ':' || solution_revision::text || ':' || status from d5o_hosted.connected_solution_states where work_id='3636863b-f1d2-4d69-8c55-37607a5667ec'"
if ($LASTEXITCODE -ne 0 -or @($position).Count -ne 1 -or $position -notmatch ':5:Submitted') { throw "preparation_review_position_mismatch:$position" }
$preparation = docker exec -e PGPASSWORD=postgres $database psql -U supabase_admin -d postgres -Atc "select id::text || ':' || title from d5o_hosted.work_records where id='edaa20bc-fdb5-4923-8d60-5bdceeb544c9' and title='Fictional relay review - PM retest'"
if ($LASTEXITCODE -ne 0 -or @($preparation).Count -ne 1 -or $preparation -notmatch 'edaa20bc-fdb5-4923-8d60-5bdceeb544c9') { throw "preparation_work_missing" }
Write-Output "RESET_PASS $name $position"
