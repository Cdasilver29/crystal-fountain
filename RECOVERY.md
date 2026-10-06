# Recovery runbook

Plain steps for the incidents this project has actually had. Written so a church officer
or a new developer can follow them under pressure. No secret is written in this file, and
none should ever be added to it.

Where things live:

| What | Where |
| --- | --- |
| The site | Vercel project `crystal-fountain`, served at https://development.newlifesdanairobi.org and https://crystal-fountain.vercel.app |
| The database | Neon project on the Launch plan. Production is the default branch, endpoint `ep-dawn-wind-b132cr2w` |
| Secrets | Vercel, Project Settings, Environment Variables, and a developer's own `.env.local` |
| DNS | The church's registrar, nameservers `ns1.geocloudafrica.com` and `ns2.geocloudafrica.com` |
| Email | Resend, sending as the newlifesdanairobi.org domain |
| Error reports | Sentry |

---

## 1. Restore the database from an earlier point in time

Use this when records were lost or damaged: a bad import, a mistaken bulk change, a
deletion that should not have happened.

> **Never use Neon's "Restore" on the production branch itself.** It resets production to
> the earlier time in place. Every pledge, payment and audit row written after that time
> disappears from the live site at once. Always restore into a **new branch** and compare
> first.

How far back you can go: the history window. On the Launch plan it is 1 day by default and
can be raised to 7 days in the Neon console, Settings, Postgres, History window. It is
billed as storage at about $0.20 per GB-month, which is very little for this database.
Keep it at 7 days.

### Steps

1. **Write down the time** you want to go back to (T), with the timezone. Pick a moment
   just before the damage. The audit page in the admin portal shows when things happened.
2. In the Neon console, open the project, go to **Branches**, choose **Create branch**,
   set the parent to production, choose **Past data**, and enter T. Name it
   `recovery-YYYYMMDD`.
3. Copy the new branch's **pooled** connection string. Do not put it in `.env.local`; a
   developer keeps it in the gitignored `branch.env.local` as `BRANCH_DATABASE_URL`.
4. **Check the branch before trusting it.** Run these counts on the branch, then the same
   counts on production restricted to rows created at or before T, and compare:

   ```sql
   select
     (select count(*) from pledgers  where created_at <= :T) as pledgers,
     (select count(*) from pledges   where created_at <= :T) as pledges,
     (select count(*) from pledge_increments where created_at <= :T) as increments,
     (select count(*) from payments  where created_at <= :T) as payments,
     (select coalesce(sum(amount_minor), 0) from payments where created_at <= :T) as payment_sum_minor,
     (select count(*) from payment_allocations where allocated_at <= :T) as allocations,
     (select count(*) from audit_log where at <= :T) as audit_rows;
   ```

   On the branch, drop the `where` clauses. The two sides should match. A difference is not
   automatically a failure: a pledge soft deleted after T still counts on production but
   shows as not deleted on the branch. Explain every difference before going on. Prove
   which database you are connected to by reading a value back, never by comparing
   connection strings.
5. If you only need a few records back, copy them from the branch into production as new
   rows, the way the treasurer corrects anything: corrections are new rows, not edits.
   Stop here and delete the branch afterwards.
6. If production itself is unusable and the branch is to become the live database:
   1. In Vercel, set `DATABASE_URL` for **Production** to the branch's pooled connection
      string.
   2. Redeploy production (Deployments, latest production deployment, Redeploy).
   3. Open the site, check the progress figures and the admin pledge list.
   4. Optionally, in Neon, use **Set as default** on the branch so future branches start
      from it.
   5. Keep the old production branch, unchanged, until everyone agrees the recovery is
      complete. It is the evidence of what happened.
7. Update `.env.local` on every developer machine to match, and record what was done and
   why in the committee minutes.
8. Delete any test or recovery branches you no longer need. Every branch's compute time is
   billed.

---

## 2. The database is unreachable

### What people see

- The home page and the progress page fail with a server error (HTTP 500). There is no
  friendly error page yet.
- The pledge form still opens, but submitting answers "Something went wrong on our side."
- The admin sign in page fails.
- Nothing is lost. Pledges that could not be submitted were never recorded, so members
  should be asked to try again later.

### Is it Neon, or is it our account?

1. Look at https://neonstatus.com. If Neon reports an incident in the
   `aws-eu-central-1` region, it is an outage: wait, and post a short notice to members.
2. If Neon is fine, open the Neon console:
   - A banner about a quota, a suspended project or a failed payment means it is
     **billing**. This is what happened on 29 September 2026, when the free plan's quota
     ran out. Fix the payment or plan on the organisation's **Billing** page, and the
     database comes back within minutes.
   - If the compute shows as **Suspended** or **Idle**, it starts on the next connection.
     That takes a second or two and is normal.
3. Check Vercel's deployment logs for the actual error. "password authentication failed"
   means `DATABASE_URL` is wrong or the password was reset (see section 4).

### Spend alert and compute cap

- **Spend alert:** organisation **Billing** page in the Neon console. Neon emails the
  organisation admins at 80% and 100% of the monthly figure you set. It only sends email:
  the database keeps running and charges keep accruing past it. Make sure at least two
  church officers receive these emails.
- **Autoscaling cap:** the production compute's settings, under **Branches**, production,
  **Computes**, Edit. It must stay at a **maximum of 1 CU**.

Why 1 CU: this site's traffic is a congregation, not the public internet, and 1 CU has
plenty of headroom for it. Every compute hour is billed, and the cap is what bounds the
bill if something goes wrong, such as a bot hammering the site or a bug that loops. Raising
it, or turning on always-on compute, needs the treasurer's agreement first.

---

## 3. DNS records are missing

### Live records

Taken from public DNS on 7 October 2026. If the site or email stops working, compare what
public DNS says now with this table. Check with any DNS lookup tool, for example
`Resolve-DnsName development.newlifesdanairobi.org -Type CNAME` in PowerShell or
https://dns.google.

| Name | Type | Value | Needed for |
| --- | --- | --- | --- |
| `development.newlifesdanairobi.org` | CNAME | `05d7cb4fca36eaa5.vercel-dns-017.com` | The pledge site. Points the subdomain at Vercel |
| `newlifesdanairobi.org` | A | `66.29.144.70` | The main church website (WordPress), and the mail server, since MX points at this name |
| `www.newlifesdanairobi.org` | CNAME | `newlifesdanairobi.org` | The main church website |
| `mail.newlifesdanairobi.org` | CNAME | `newlifesdanairobi.org` | The church's own mailboxes |
| `newlifesdanairobi.org` | MX | `0 newlifesdanairobi.org` | Receiving email at the domain. Depends on the root A record above |
| `newlifesdanairobi.org` | TXT | `v=spf1 ip4:66.29.144.70 ip4:66.29.147.26 ip4:66.29.128.146 ip4:209.188.21.232 +a +mx +ip4:66.29.132.73 +ip4:66.29.132.80 include:spf.web-hosting.com ~all` | SPF for mail sent by the church's own mail host |
| `newlifesdanairobi.org` | TXT | `google-site-verification=...` | Google Search Console ownership |
| `resend._domainkey.newlifesdanairobi.org` | TXT | `p=MIGfMA0GCSqGSIb3DQEB...` (a public key, copy the full value from the Resend dashboard) | DKIM: lets receivers trust email this site sends through Resend |
| `send.newlifesdanairobi.org` | CNAME | `send.forge.rmta.net` | Resend's bounce and SPF domain. Through it, MX `10 feedback.forge.rmta.net` and SPF `v=spf1 ip4:52.3.252.119 ip4:44.222.39.36 ip4:199.249.231.0/24 ~all` |
| `_dmarc.newlifesdanairobi.org` | TXT | `v=DMARC1; p=none;` | DMARC. Monitoring only for now |
| `newlifesdanairobi.org` | NS | `ns1.geocloudafrica.com`, `ns2.geocloudafrica.com` | Who answers for the whole domain |

Notes:

- **https://crystal-fountain.vercel.app keeps working when the custom domain is down.**
  It does not depend on the church's DNS at all. Share it with members as the fallback
  address. The pledge forms accept submissions on it.
- The Resend records are the authority. If Resend shows the domain as anything other than
  **Verified**, copy the records it lists back into DNS exactly.
- `p=none` on DMARC means receivers report on failures but still deliver. Moving to
  `p=quarantine` is a decision for later, after a few weeks of clean reports.

### Restoring a missing record

1. Sign in to the registrar's DNS panel for newlifesdanairobi.org.
2. Re-create the record exactly as in the table. For the Vercel CNAME, Vercel's project
   **Domains** page shows the current target if it ever changes.
3. Wait for the TTL (usually 20 minutes to 4 hours), then check with a lookup tool.
4. Vercel re-issues the HTTPS certificate on its own once the CNAME resolves.

---

## 4. A secret leaked

Every secret is set in two places: **Vercel** (Project Settings, Environment Variables,
for Production and Preview) and a developer's **`.env.local`**. Change both. A change in
Vercel takes effect only after a **redeploy**.

To generate a new random secret, on any machine with Node:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

| Secret | How to get a new one | What breaks when it changes |
| --- | --- | --- |
| Database password (inside `DATABASE_URL`) | Neon console, **Roles**, `neondb_owner`, **Reset password**. Copy the new pooled connection string | The site fails for everyone from the moment of the reset until Vercel has the new value **and has been redeployed**. Update Vercel and `.env.local` together and redeploy straight away. Test branches made earlier keep the old password |
| `BETTER_AUTH_SECRET` | Generate | Every admin is signed out. The daily email limit counters start again, because they are keyed from this secret. **Also: authenticator app enrolments are encrypted with it.** Changed outright, every admin with an authenticator can no longer pass the code step. See the safe method below |
| `OWNER_COOKIE_SECRET` | Generate. Must differ from `BETTER_AUTH_SECRET` | Members' browsers lose the proof that they made their pledge. Each member's next addition to an existing pledge is held for the treasurer to confirm, until they make a fresh pledge from that browser. Nothing is lost |
| `CRON_SECRET` | Generate | Nothing visible. Vercel sends it to the daily job automatically after the redeploy |
| `TURNSTILE_SECRET_KEY` | Cloudflare dashboard, Turnstile, the site's widget, **Rotate secret key** | Pledges and lookups are refused until Vercel has the new key and is redeployed. Do it at a quiet hour |
| `GOOGLE_CLIENT_SECRET` | Google Cloud console, APIs and Services, Credentials, the OAuth client. **Add** a new secret, deploy it, then disable the old one | Google sign in fails in between if the old one is disabled first. Password sign in is unaffected |
| `RESEND_API_KEY` | Resend dashboard, API Keys. Create a new key, deploy it, then delete the old key | Confirmation and notice emails stop until the new key is deployed. Pledges are still recorded |
| `ADMIN_SECRET` | Nothing to generate | **No longer used by the code.** Delete it from Vercel and `.env.local` |

### Rotating `BETTER_AUTH_SECRET` without locking anyone out

Better Auth can hold a new secret and the old one together:

1. Generate a new value.
2. In Vercel, add `BETTER_AUTH_SECRETS` with the value `1:<new value>`. Leave
   `BETTER_AUTH_SECRET` as it is: Better Auth uses it as the legacy key to read what was
   encrypted before.
3. Redeploy. Everyone signs in again; authenticator codes still work.
4. Try this on a preview deployment first. It has not yet been rehearsed on this project.

If that is not possible, change `BETTER_AUTH_SECRET` outright and then reset every
administrator's authenticator (section 5) so they can enrol again.

### Safe order during the ownership handover

Do this at a quiet hour, with the new owner present, one secret at a time, checking the
site between each:

1. Write the plan down and tell the treasurer and admins the portal will sign them out.
2. `ADMIN_SECRET`: delete it.
3. `CRON_SECRET`: change, redeploy. Check the next day's digest arrives.
4. `RESEND_API_KEY`: create new, deploy, test with a small pledge on a preview, delete old.
5. `GOOGLE_CLIENT_SECRET`: add new, deploy, sign in with Google, then disable old.
6. `TURNSTILE_SECRET_KEY`: rotate, deploy, make a test lookup.
7. `OWNER_COOKIE_SECRET`: change, deploy. Expect a few held additions in the next weeks.
8. `BETTER_AUTH_SECRET`: by the safe method above. Every admin signs in again.
9. Database password: reset, update Vercel and `.env.local`, redeploy immediately, check
   the progress page and the admin list.
10. Move ownership of the Neon, Vercel, Cloudflare, Google Cloud, Resend and Sentry
    accounts, and remove the previous owner's access from each.
11. Old copies: Claude Code sessions on the developer's laptop keep transcripts under
    `%USERPROFILE%\.claude\projects\`. Credentials pasted into a session are stored there.
    Delete old transcripts once rotation is done.

---

## 5. An admin has lost their authenticator

There is no reset button in the portal yet.

**Quickest way back in:** if their Google account is linked and allowed, **Sign in with
Google** does not ask for an authenticator code. They can work normally while the reset
below is done.

**Reset**, done by a developer with database access, at the request of the super
administrator, after confirming the person's identity by phone or in person:

```sql
begin;

delete from auth_two_factors
where user_id = (select auth_user_id from admin_users where email = 'person@example.org');

insert into audit_log (actor_type, actor_id, action, entity, entity_id, after)
select 'admin', (select id from admin_users where is_super), 'admin.totp_enrolment_reset',
       'admin_users', id, jsonb_build_object('email', email, 'reason', 'lost authenticator')
from admin_users where email = 'person@example.org';

commit;
```

Check the delete removed exactly one row before committing. On their next sign in, the
portal notices the missing enrolment, clears the leftover flag and offers to set up a new
authenticator.

---

## 6. Fewer than two people can approve a payment detail change

A change to where members send money (paybill, account format, bank details) needs a
second person: a treasurer or another administrator approves it, and the person who asked
never can. If nobody else is available, the change waits, and it expires after 7 days.

There is deliberately **no bypass**. That rule is what stops one compromised or mistaken
account from redirecting the congregation's money.

What to do:

1. The super administrator adds a treasurer or a second administrator in **Users**.
2. That person signs in, sets their password and authenticator, and approves the change in
   **Settings**.
3. If the request expired, make it again.

Keep at least two active people who can approve at all times, so this is never urgent.

---

## 7. Backups outside Neon

Neon's history window and branches are real backups, but they are all held by one
provider, in one account. A billing failure, a closed account or a mistaken project
deletion takes them away together with production.

Recommendation, not yet built: a **weekly encrypted export** (`pg_dump`, encrypted with a
key the church holds) copied to storage the church owns, such as a church owned cloud
storage bucket or drive, kept for at least a year. It needs a church owned storage account
first. Once that exists, it is a small scheduled job. See PLAN.md, section 18.
