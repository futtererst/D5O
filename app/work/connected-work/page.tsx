import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { customerAdminWorkspaceAuthorized } from "@/lib/d5o/admin/customer-workspace";
import { ConnectedWorkStart } from "@/components/d5o/admin/ConnectedWorkStart";
import styles from "../admin/[[...section]]/admin.module.css";
import "../enterprise.css";
import "../admin/[[...section]]/admin-console.css";

export const dynamic="force-dynamic";
export default async function ConnectedWorkPage({searchParams}:{searchParams:Promise<{workspace?:string}>}) {
  const {workspace=""}=await searchParams;
  if(!/^[a-z][a-z0-9_-]{1,63}$/.test(workspace))notFound();
  try {if(!await customerAdminWorkspaceAuthorized(workspace))notFound();}
  catch(error){if(error instanceof Error&&error.message==="unauthenticated")
    redirect(`/auth/sign-in?next=${encodeURIComponent(`/work/connected-work?workspace=${workspace}`)}`);
    throw error;}
  return <main className={`${styles.shell} d5o-admin-console`}><div className={styles.frame}>
    <aside className={styles.rail}><strong>Tenant: {workspace}</strong><nav className={styles.nav}>
      <Link href={`/work/admin/configuration?workspace=${workspace}`}>Configuration</Link>
      <Link href={`/work/connected-work?workspace=${workspace}`} aria-current="page">Connected Work</Link>
    </nav></aside><div className={styles.mainColumn}><header className={styles.header}>
      <div><p>Work / Connected Work</p><h1>Start connected Work</h1></div></header>
      <section className={styles.content}><ConnectedWorkStart workspace={workspace} /></section>
    </div></div></main>;
}
