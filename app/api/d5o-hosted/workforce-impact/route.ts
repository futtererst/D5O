import { NextRequest, NextResponse } from "next/server";
import { hostedPrototypeContext, HostedStateError } from "@/lib/d5o/hosted/prototype-context";
import { createRybexSupabaseServerClient } from "@/lib/d5o/auth/supabase-server";
import { shiftHours, type Assignment, type PublishedSchedule, type SharedSchedule } from "@/components/d5o/platform/schedule-model";
import { customerWorkspaceKey } from "@/lib/d5o/hosted/customer-work-scope";

export const dynamic = "force-dynamic";
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
type Person = { id: string; person: string; active: boolean; bound: boolean; qualifications: string[]; weeklyCapacityHours: number; profileRevision: number };
type Catalog = { records?: Array<{ id: string; title: string; type: string; phaseConfigurationVersionId?: string }>; packages?: Array<{ id: string; name: string; workId: string }> };
type Configuration = { versions?: Array<{ id: string; manifest?: { d5oPresentation?: { phaseContract?: { workTypes?: Array<{
  workTypeKey: string; workTypeLabel: string; operateControls?: { timezone?: string }
}> } } } }> };
const sameBooking = (a: Assignment, b: Assignment) => a.id === b.id && a.workId === b.workId &&
  a.packageId === b.packageId && a.date === b.date && a.shift === b.shift &&
  a.week === b.week && a.day === b.day && a.crew === b.crew &&
  a.personHoursPerWorker === b.personHoursPerWorker && JSON.stringify(a.people) === JSON.stringify(b.people);

function localClock(timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  const value = (kind: string) => parts.find((part) => part.type === kind)?.value ?? "";
  const date = `${value("year")}-${value("month")}-${value("day")}`;
  const yesterday = new Date(Date.UTC(Number(value("year")), Number(value("month")) - 1, Number(value("day")) - 1)).toISOString().slice(0, 10);
  return { date, yesterday, time: `${value("hour")}:${value("minute")}` };
}

function futureBooking(item: Assignment, clock: ReturnType<typeof localClock>) {
  const date = item.date ?? "";
  if (date > clock.date) return true;
  const times = item.shift.match(/^(\d\d:\d\d)[–-](\d\d:\d\d)$/);
  if (!times) return false;
  const [, start, end] = times;
  if (date === clock.date) return end <= start || end > clock.time;
  return date === clock.yesterday && end <= start && end > clock.time;
}

export async function GET(request: NextRequest) {
  const workspace = request.nextUrl.searchParams.get("workspace");
  const personId = request.nextUrl.searchParams.get("personId");
  if (!(workspace === "rybex" || workspace && customerWorkspaceKey.test(workspace) && workspace !== "rotork") ||
    !personId || !/^[0-9a-f-]{36}$/i.test(personId)) return reply({ error: "invalid_scope" }, 400);
  try {
    const context = await hostedPrototypeContext(workspace);
    if (context.actor.role !== "admin") return reply({ error: "admin_membership_required" }, 403);
    const client = await createRybexSupabaseServerClient();
    const call = client.rpc.bind(client) as unknown as (name: string, args: Record<string, unknown>) => Promise<{
      data: unknown; error: { message: string } | null;
    }>;
    const [workforce, scheduleResult, catalogResult, configuration] = await Promise.all([
      call("d5o_hosted_workforce_read_v1", { p_workspace_key: workspace }),
      context.read("schedule"), context.read("catalog"),
      call("d5o_hosted_configuration_admin_read_v1", { p_workspace_key: workspace })
    ]);
    if (workforce.error || !workforce.data || configuration.error || !configuration.data ||
      (!scheduleResult.state && scheduleResult.revision !== 0) ||
      (!catalogResult.state && catalogResult.revision !== 0))
      return reply({ error: "impact_sources_unavailable" }, 503);
    const source = workforce.data as { revision: number; people: Person[] };
    const person = source.people.find((item) => item.id === personId);
    if (!person) return reply({ error: "person_not_found" }, 404);
    const schedule = (scheduleResult.state ?? {}) as SharedSchedule;
    const catalog = (catalogResult.state ?? {}) as Catalog;
    const versions = (configuration.data as Configuration).versions ?? [];
    const timezoneFor = (workId: string) => {
      const work = catalog.records?.find((record) => record.id === workId);
      const version = versions.find((item) => item.id === work?.phaseConfigurationVersionId);
      return version?.manifest?.d5oPresentation?.phaseContract?.workTypes?.find((item) =>
        item.workTypeKey === work?.type || item.workTypeLabel === work?.type)?.operateControls?.timezone ?? null;
    };
    const clocks = new Map<string, ReturnType<typeof localClock>>();
    const future = (item: Assignment) => {
      const timezone = timezoneFor(item.workId);
      if (!timezone) return (item.date ?? "") >= new Date().toISOString().slice(0, 10);
      if (!clocks.has(timezone)) clocks.set(timezone, localClock(timezone));
      return futureBooking(item, clocks.get(timezone)!);
    };
    const assignments = schedule.assignments ?? [];
    const publications = schedule.publications ?? [];
    const latestForWeek = (week: number) => [...publications].reverse().find((item) => item.week === week);
    const current = assignments.filter((item) => item.people.includes(person.person) && future(item));
    const retained = publications.flatMap((publication: PublishedSchedule) => publication.assignments
      .filter((item) => item.people.includes(person.person) && future(item) && latestForWeek(item.week)?.id === publication.id)
      .filter((item) => !current.some((draft) => sameBooking(draft, item)))
      .map((item) => ({ ...item, retainedPublicationId: publication.id })));
    const entries = [...current.map((item) => ({ ...item, retainedPublicationId: "" })), ...retained];
    const items = entries.map((item: Assignment & { retainedPublicationId: string }) => {
      const publication = latestForWeek(item.week);
      const published = publication?.assignments.some((entry) => sameBooking(entry, item));
      const requirement = schedule.packageDemands?.find((entry) => entry.workId === item.workId && entry.packageId === item.packageId);
      const weekHours = assignments.filter((entry) => entry.week === item.week && entry.people.includes(person.person))
        .reduce((sum, entry) => sum + shiftHours(entry.shift), 0);
      const issues = [
        ...(!timezoneFor(item.workId) ? ["Pinned Work time zone unavailable; verify whether this shift is still future"] : []),
        ...(item.retainedPublicationId ? ["Published worker instruction differs from the current draft"] : []),
        ...(!person.active ? ["Roster person inactive"] : []),
        ...(!person.bound ? ["No current confirmed worker-account binding and active field-worker membership"] : []),
        ...(requirement?.qualification && !person.qualifications.includes(requirement.qualification)
          ? [`Missing ${requirement.qualification} qualification`] : []),
        ...(weekHours > person.weeklyCapacityHours ? [`${weekHours}h scheduled against ${person.weeklyCapacityHours}h weekly capacity`] : [])
      ];
      return { assignmentId: item.id, workId: item.workId, workTitle: catalog.records?.find((record) => record.id === item.workId)?.title ?? "Work Record",
        packageId: item.packageId, packageName: catalog.packages?.find((entry) => entry.id === item.packageId)?.name ?? "Work Package",
        date: item.date, shift: item.shift, timezone: timezoneFor(item.workId), week: item.week, publicationId: item.retainedPublicationId || (published ? publication?.id : null),
        publicationState: item.retainedPublicationId ? "Published snapshot; current draft differs" : published ? "Published current booking" : "Draft or changed since publication",
        acknowledged: Boolean(publication && schedule.receipts?.some((receipt) => receipt.publicationId === publication.id && receipt.assignmentId === item.id && receipt.recipient === person.person && receipt.response === "acknowledged")),
        requiredQualification: requirement?.qualification ?? null, weekHours, currentIssues: issues,
        nextAction: "PM or Operations: inspect this Crew booking, make a governed correction and republish if changed; obtain a fresh worker response. Workforce Admin: resolve only the roster or access condition." };
    });
    return reply({ personId, person: { active: person.active, bound: person.bound, qualifications: person.qualifications,
      weeklyCapacityHours: person.weeklyCapacityHours, profileRevision: person.profileRevision },
      workforceRevision: source.revision, scheduleRevision: scheduleResult.revision,
      asOf: new Date().toISOString(), items });
  } catch (error) {
    return error instanceof HostedStateError ? reply({ error: error.code }, error.status) : reply({ error: "impact_unavailable" }, 503);
  }
}
