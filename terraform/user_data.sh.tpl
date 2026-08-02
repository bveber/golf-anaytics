#!/bin/bash
set -euo pipefail

dnf install -y docker git jq
systemctl enable --now docker

# Swap - cheap headroom for Playwright/Chromium on a t3.small (2GB RAM).
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# Docker Compose v2 plugin
mkdir -p /usr/local/lib/docker/cli-plugins
curl -sL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64" \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

# dnf's bundled docker-buildx-plugin (0.12.1) is too old for `docker compose build`
# on current Compose releases (requires 0.17+) - replace with a current release.
BUILDX_VERSION=$(curl -fsSL https://api.github.com/repos/docker/buildx/releases/latest | grep -oP '"tag_name": "\K[^"]+')
curl -fsSL "https://github.com/docker/buildx/releases/download/$${BUILDX_VERSION}/buildx-$${BUILDX_VERSION}.linux-amd64" \
  -o /usr/libexec/docker/cli-plugins/docker-buildx
chmod +x /usr/libexec/docker/cli-plugins/docker-buildx

mkdir -p /opt/golf-analytics
if [ ! -d /opt/golf-analytics/.git ]; then
  git clone https://github.com/${github_repo}.git /opt/golf-analytics
fi

/opt/golf-analytics/scripts/deploy.sh
