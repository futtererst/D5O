# Phase 2B vendor administration permissions

| Operation | Active platform administrator | Active tenant administrator | Other authenticated user | Anonymous |
| --- | --- | --- | --- | --- |
| Read tenant and template directory | Yes | Denied | Denied | Denied |
| Provision tenant | Yes | Denied | Denied | Denied |
| Draft, validate, publish, retire template | Yes | Denied | Denied | Denied |
| Recover initial invitation | Yes | Denied | Denied | Denied |
| Activate ready tenant | Yes | Denied | Denied | Denied |
| Accept initial admin offer | Only exact recipient | Only exact recipient | Only exact recipient | Denied |
| Read/confirm own onboarding | If also tenant admin | Yes, own tenant | Denied | Denied |
| Change own tenant approval policy | If separately tenant admin | Yes, own tenant | Denied | Denied |

Vendor authority is the existing `platform_administrators` row, checked against `auth.uid()` inside every vendor RPC. Tenant `admin` membership never implies vendor authority. The platform API uses the caller's authenticated Supabase client for vendor commands. Only the narrowly scoped provider-outcome RPC accepts the server service role; its caller supplies the vendor actor already recorded on the invitation. New hosted tables are not directly granted to browser roles, and all new public RPCs explicitly revoke anonymous execution. CSRF origin checks protect mutation routes; the database remains the authoritative permission boundary.

Pilot-specific customer administration and service-approval restrictions remain in place. The new membership-backed path is limited to the provisioned organization/configuration/onboarding routes and does not broaden pilot business commands.
