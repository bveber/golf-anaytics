# Development Lifecycle

This is a single-user hobby project, not a production SaaS — the goal is a
lifecycle that's cheap, low-maintenance, and hard to get wrong, not one with
staging environments, blue/green deploys, or an on-call rotation.

**Principle:** validate everything you can on your laptop first. The only
thing that should happen automatically on AWS is deploying code/infra that
already passed local checks and review.

> This document describes the *target* setup. As of now the repo has no
> `.github/workflows/`, no Terraform, and no AWS compute running — the pieces
> below (ECR, EC2, Terraform state bucket, GitHub Actions) need to be created
> once, following the "First-time setup" section. Treat the choices here
> (EC2 + docker compose, Terraform, GitHub Actions) as a proposal — flag
> anything you'd rather do differently.

## 1. Local development loop

Day-to-day work never touches AWS:

```bash
make setup                          # one-time: venv, deps, Playwright
make api                            # FastAPI on :8000, auto-reload
make frontend                       # Vite dev server on :5173
make dry-run                        # exercise the scraper without writing to DB
```

For changes that touch the containerized runtime (Dockerfiles, compose,
nginx config, env var wiring), validate with the same images CI will build:

```bash
make docker-build
make docker-up                      # api on :8000, frontend on :8080
make docker-logs
make docker-down
```

Before opening a PR:

```bash
cd frontend && npm run lint
cd frontend && npm run build        # type-check + production build
.venv/bin/pytest                    # backend tests
```

## 2. Branching & PRs

- `main` is always deployable — every commit on `main` is expected to go live.
- Work happens on short-lived feature branches, merged via PR (matches
  `#1`–`#3` in this repo's history).
- No direct pushes to `main`.

## 3. CI on pull requests (validate, never deploy)

A `.github/workflows/pr-checks.yml` workflow runs on every PR and blocks
merge on failure:

| Job | Command |
|---|---|
| Backend lint/type-check | `ruff check .` |
| Backend tests | `pytest` |
| Frontend lint | `npm run lint` (in `frontend/`) |
| Frontend build | `npm run build` (in `frontend/`) |
| Image build sanity | `docker build -f Dockerfile.api .` / `-f Dockerfile.frontend .` |
| Terraform | `terraform fmt -check` + `terraform validate` (in `infra/`) |

This job builds images to catch Dockerfile breakage early but never pushes
them anywhere — no AWS credentials are exposed to PR runs from forks.

## 4. Merge to `main` → deploy to AWS

A second workflow, `.github/workflows/deploy.yml`, triggers on `push` to
`main` and does, in order:

1. **Build & push images** — build `Dockerfile.api` and `Dockerfile.frontend`,
   tag with the commit SHA, push to ECR (`golf-analytics-api`,
   `golf-analytics-frontend`).
2. **Apply infra** — `terraform apply -auto-approve` in `infra/`, using a
   remote state backend (S3 + DynamoDB lock table, created once during
   first-time setup). Most runs are a no-op plan; this only changes
   anything when someone edited `infra/*.tf`.
3. **Deploy code** — SSH to the EC2 instance (via AWS SSM `send-command`,
   no open SSH port needed) and run:
   ```bash
   aws ecr get-login-password | docker login --username AWS --password-stdin <account>.dkr.ecr.<region>.amazonaws.com
   docker compose pull
   docker compose up -d
   ```
4. **Smoke check** — `curl` the API's `/health` endpoint post-deploy; fail
   the workflow (and leave the previous containers as the last known-good
   images tagged `:previous`) if it doesn't return 200 within a short
   timeout.

If step 4 fails, the fix is `git revert` on `main`, not a manual AWS console
change — infra and code state should always trace back to a commit.

## 5. Target AWS architecture

Kept deliberately close to what already runs locally via `docker-compose.yml`:

- **Compute:** one EC2 instance (small, e.g. `t3.small`) running the same
  two containers as local docker compose — no ECS/Fargate/ALB. A single
  user doesn't need orchestration.
- **Persistence:** the DuckDB file lives on the instance's EBS volume,
  mounted the same way `docker-compose.yml` mounts `./db` locally. This
  preserves the "single file, fresh `duckdb.connect()` per request" model
  from `CLAUDE.md` without a redesign.
- **Backups:** `backup.py` already writes to `backups/db/`; extend it (or a
  cron job on the instance) to sync that directory to the `BACKUP_S3_BUCKET`
  referenced in `.env.example`.
- **Secrets:** r-cloud credentials and `SESSION_SECRET` stay in AWS Secrets
  Manager, matching `api/secrets.py`'s existing `golf-analytics/rcloud-creds`
  convention. GitHub Actions gets a narrowly-scoped IAM role (OIDC, no
  long-lived access keys) that can push to ECR, run `terraform apply`, and
  issue SSM commands — nothing more.
- **Images:** ECR repos for `golf-analytics-api` and `golf-analytics-frontend`.
- **Networking:** instance in a public subnet with a security group open on
  443/80 only (frontend nginx container); API is reached through the
  frontend/nginx, not exposed directly to the internet.

This is intentionally the smallest architecture that satisfies "deployed to
AWS on merge" — revisit only if traffic, uptime needs, or team size change.

## 6. Infra as code

- Terraform, state in an S3 backend with DynamoDB locking.
- Lives in `infra/` at the repo root: `main.tf`, `variables.tf`,
  `outputs.tf`, split by resource type (`ec2.tf`, `ecr.tf`, `iam.tf`,
  `secrets.tf`, `s3.tf`) once it grows past a single file.
- Infra changes go through the same PR process as code — `terraform plan`
  output posted as a PR comment, reviewed like any diff, applied
  automatically only after merge (step 2 above).

## 7. First-time setup (do once, manually)

Before the pipeline above can run, someone has to bootstrap the handful of
resources Terraform needs to already exist to manage everything else:

1. S3 bucket + DynamoDB table for Terraform state.
2. ECR repositories.
3. IAM OIDC provider + role for GitHub Actions (least-privilege: ECR push,
   `terraform apply` on the specific state bucket, SSM `send-command` on the
   specific instance).
4. Secrets Manager entries seeded with real values.

Everything after this point — the EC2 instance itself, its security group,
IAM instance profile, EBS volume — is created by Terraform, not by hand.

## 8. Rollback

- **Code:** `git revert` the offending commit on `main`; the deploy workflow
  redeploys the previous image tags automatically.
- **Infra:** `git revert` the Terraform change; `terraform apply` reverts
  the resource.
- **Data:** restore the DuckDB file from the most recent `backups/db/` S3
  snapshot; there is no in-place migration story since there's only one
  environment and one file.
