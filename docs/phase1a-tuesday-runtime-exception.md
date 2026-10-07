# Phase 1A Tuesday runtime exception

## Decision

The Phase 1A Tuesday demo may temporarily run the Helmonic Next.js process as
root inside its Azure Container App container so it can bind the app's existing
target port `80`.

This is a narrowly scoped exception for the Tuesday 25 August 2026 demo. It is
not an approved production configuration and must not be used for customers,
non-demo data, a wider audience, or any environment beyond this demo.

## Why the exception exists

The non-root image could not bind port `80` in Azure Container Apps. Applying
`CAP_NET_BIND_SERVICE` to the Node executable during the image build did not
survive or take effect in the Container Apps runtime, and the revision exited
with:

```text
listen EACCES: permission denied 0.0.0.0:80
```

Changing the Container App ingress target to `8080` now would also affect the
known-good port-80 revision. The temporary root image therefore preserves the
current rollback path and avoids an app-wide ingress change immediately before
the demo.

## Mandatory controls for the temporary revision

The root image must not receive traffic until all of these checks pass:

1. It is deployed as an immutable revision at `0%` traffic and validated before
   any routing change.
2. The known-good revision remains available for immediate rollback.
3. HTTPS-only ingress remains enforced.
4. Platform authentication is enabled and rejects unauthenticated requests.
5. Container Apps ingress has the previously approved source-IP allowlist and
   denies traffic from all other public IP addresses.
6. CORS remains unset/disabled. The approved demo path is the Container App-hosted UI
   on the same origin; Vercel and other cross-origin callers are not allowed.
7. Only the Phase 1A demo routes and approved controlled dataset are used. The dataset
   began with five documents and was later extended through approved ingestion to
   sixteen; arbitrary browser uploads remain prohibited under this exception.
8. Azure access remains managed-identity based. No keys, passwords, connection
   strings, or long-lived Azure credentials may be added to the image.
9. The app remains on its existing CPU, memory, and scale settings unless a
   separate costed change is approved.

Authentication and IP allowlisting are release gates, not follow-up work. If
either control cannot be verified, the root revision stays at `0%` traffic.

## Hard exit gate before any use beyond Tuesday

Before this environment is exposed to anything beyond the Tuesday demo, all of
the following must be completed:

1. Change the application listener to unprivileged port `8080`.
2. Restore a dedicated non-root runtime user in the final image and add an
   automated/runtime check proving the application UID is not `0`.
3. Move Container Apps ingress target port to `8080` through a controlled
   rollout that preserves a tested rollback path.
4. Deploy the non-root image as a new immutable revision at `0%` traffic.
5. Validate `/healthz`, `/readyz`, the Consult request path, and all required
   managed-identity/private-endpoint dependencies.
6. Reconfirm authentication, IP allowlisting, HTTPS-only ingress, and disabled CORS
   before routing traffic.
7. Shift traffic only after the checks pass, then deactivate every root-running
   Helmonic revision.
8. Verify no active revision or deployable image intended for wider use carries
   the `com.helmonic.runtime-exception` label.

The non-root/port-8080 migration is a blocking release requirement. It may not
be waived by relabelling this DEV environment or by promoting the demo image.

## Rollback and closure

- During Tuesday validation, any failed health, readiness, authentication, IP,
  CORS, or dependency check means no traffic shift.
- During the demo, route immediately back to the known-good revision if the
  Helmonic revision becomes unhealthy.
- After the demo, return the root revision to `0%`, deactivate it, and complete
  the non-root/port-8080 exit gate before further exposure.
- Record the replacement commit and revision in the pull request before this
  exception is considered closed.

## Closure progress - 26 August 2026

The first Phase 1B local slice removes the exception from source: the Docker image now
uses the built-in non-root `node` user, listens on and exposes port `8080`, assigns the
runtime files to that user, and carries no `com.helmonic.runtime-exception` label. A
repository verification script fails CI and the image workflow if those invariants
regress. `/healthz` now reports the runtime user ID and whether it is non-root where the
operating system exposes that information.

The hardened image has now passed its zero-traffic Azure gate. Revision
`ca-helmonic-consult-dev-002--p1b69b6b7a` runs immutable image
`helmonic-consult:69b6b7af9283657c9f509385fcb2050ab01c65c4` with minimum replicas
0 and 0% traffic. Console validation on 26 August 2026 proved UID `1000`,
`/healthz` 200 with `nonRoot: true`, and `/readyz` 200 using the inherited
managed-identity/private-service configuration. Its temporary validation label was
removed after the checks, and Azure confirmed the revision returned to 0 replicas.

The serving-path exception was removed on 26 August 2026. Azure Portal confirms
application-scope ingress now targets port 8080 and `--p1b69b6b7a` receives 100% of
traffic, while `--ca72a0c` and `--0000001` remain active at 0%. The source-IP rule
`86.43.74.56/32` remained unchanged. The authenticated live Consult UI loaded from the
main application URL and a live sound-insulation query returned four server-verified
document/page citations in the Sources panel.

The old root revision is intentionally retained at 0% for rollback, so the final
administrative deactivation step is still open even though root code no longer serves
live requests. Closing that rollback window requires a separate decision to deactivate
every root-running Helmonic revision. Until then, rollback to `--ca72a0c` must restore
both ingress port 80 and its traffic allocation; traffic-only rollback would not make
the port-80 image reachable.
