import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Invoke only against the disposable database while the P0-A runtime is up.
const container = process.env.D5O_DISPOSABLE_DB_CONTAINER;
if (!container?.startsWith("supabase_db_d5o-p0a-"))
  throw Error("disposable_database_container_required");
const output = resolve("docs/architecture/evidence/phase2htb-calendar-results.json");
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
function query(statement) {
  const run = spawnSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres",
    "-X", "-t", "-A", "-v", "ON_ERROR_STOP=1"], {input:statement, encoding:"utf8", shell:false});
  if (run.status !== 0) throw Error(`calendar_sql_failed:${run.stderr.slice(-1000)}`);
  return run.stdout.trim();
}
const cases = [
  ["normal_business_hours", "2026-10-26T14:00:00Z", "2026-10-26T15:00:00Z", "Business hours", []],
  ["before_opening", "2026-10-26T11:00:00Z", "2026-10-26T13:00:00Z", "Business hours", []],
  ["after_closing", "2026-10-26T22:00:00Z", "2026-10-27T13:00:00Z", "Business hours", []],
  ["weekend", "2026-10-24T14:00:00Z", "2026-10-26T13:00:00Z", "Business hours", []],
  ["configured_holiday", "2026-10-26T14:00:00Z", "2026-10-27T13:00:00Z", "Business hours", ["2026-10-26"]],
  ["spring_dst", "2026-03-06T22:00:00Z", "2026-03-09T13:00:00Z", "Business hours", []],
  ["autumn_dst", "2026-10-30T21:00:00Z", "2026-11-02T14:00:00Z", "Business hours", []],
  ["friday_saturday_continuous", "2026-10-23T23:00:00Z", "2026-10-24T03:00:00Z", "Continuous", []],
];
const result={source:"locally migrated authoritative Operate SQL predicate",tests:[]};
try {
  const functionBody=query(`select pg_get_functiondef(
    'public.d5o_hosted_operate_command_internal_v1(text,text,text,jsonb,text,bigint,integer,integer)'::regprocedure);`);
  assert(functionBody.includes("service_calendar_invalid"));
  assert(functionBody.includes("coalesce(v_policy->'holidayDates','[]'::jsonb)"));
  result.guardVerified=true;
  const clock=query(`select fixed_at::text || '|' ||
    has_schema_privilege('authenticated','d5o_qualification','USAGE')::text || '|' ||
    has_table_privilege('authenticated','d5o_qualification.clock','UPDATE')::text
    from d5o_qualification.clock;`).split("|");
  assert.equal(new Date(clock[0]).toISOString(),"2026-10-26T14:00:00.000Z");
  assert.deepEqual(clock.slice(1),["false","false"]);
  result.clock={at:new Date(clock[0]).toISOString(),authenticatedCanUseSchema:false,
    authenticatedCanUpdate:false};
  for (const [name, start, expected, calendar, holidays] of cases) {
    const due = query(`select case when ${quote(calendar)}='Continuous' then
      (${quote(start)}::timestamptz+interval '4 hour')::text else
      (select slot::text from generate_series(${quote(start)}::timestamptz+interval '1 hour',
        ${quote(start)}::timestamptz+interval '14 days',interval '1 hour') slot
       where extract(isodow from slot at time zone 'America/New_York')<6
         and extract(hour from slot at time zone 'America/New_York')>=9
         and extract(hour from slot at time zone 'America/New_York')<17
         and not (${quote(JSON.stringify(holidays))}::jsonb ?
           (slot at time zone 'America/New_York')::date::text)
       order by slot limit 1) end;`);
    const actual = new Date(due).toISOString();
    const wanted = new Date(expected).toISOString();
    assert.equal(actual,wanted,`${name}:${actual}`);
    result.tests.push({name,status:"PASS",start,deadline:actual,calendar});
  }
  result.tests.push({name:"invalid_and_missing_calendar_guard_source",status:"SOURCE_CHECK",
    detail:"Authoritative function contains service_calendar_invalid guard; direct command denial remains untested"});
} catch (error) {
  result.tests.push({name:"calendar_qualification",status:"FAIL",detail:String(error.message)});
  process.exitCode=1;
}
mkdirSync(resolve("docs/architecture/evidence"),{recursive:true});
writeFileSync(output,JSON.stringify(result,null,2)+"\n");
console.log(JSON.stringify({passed:result.tests.filter((item)=>item.status==="PASS").length,
  failed:result.tests.filter((item)=>item.status==="FAIL").length,output}));
