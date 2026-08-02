#!/bin/bash
# Redeploys the app on the EC2 instance: pull latest code, refresh the .env
# from SSM Parameter Store, rebuild containers, restart. Invoked by user_data
# on first boot and by the GitHub Actions deploy workflow via `aws ssm send-command`.
set -euo pipefail

cd /opt/golf-analytics

git fetch origin
git reset --hard origin/main

aws ssm get-parameter \
  --name /golf-analytics/app-env \
  --region us-east-1 \
  --with-decryption \
  --query Parameter.Value --output text \
  | jq -r 'to_entries[] | "\(.key)=\(.value)"' > .env

# Cert Caddy presents to the gateway Lambda's pinned-cert check (see
# terraform/origin_cert.tf) - not a publicly trusted cert, browsers never see it.
mkdir -p certs
aws ssm get-parameter --name /golf-analytics/origin-cert --region us-east-1 \
  --query Parameter.Value --output text > certs/origin.crt
aws ssm get-parameter --name /golf-analytics/origin-key --region us-east-1 \
  --with-decryption --query Parameter.Value --output text > certs/origin.key
chmod 600 certs/origin.key

docker compose up -d --build
docker image prune -f
